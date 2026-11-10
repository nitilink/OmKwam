// Client-side audio pre-processing to make Gemini transcription more reliable
// for long recordings and for quiet/unclear audio.
//
// Two independent improvements live here:
//
// 1. Chunking - long recordings are split into shorter pieces before being
//    sent to Gemini, one request per piece. Cuts are placed at the quietest
//    point near each target boundary instead of at a fixed time.
//
// 2. Gain boost - quiet clips/chunks are scaled up before sending.
//
// Memory: planAudioChunks() only records sample boundaries (no WAVs are
// built up front). buildChunkAudioBlob() encodes ONE chunk at a time; the
// caller sends it and drops it before the next chunk, so we never hold every
// WAV in memory together. During a full run the caller decodes the source once
// (decodeAudioSource) and passes it in; for a single-chunk retry the source is
// re-decoded and re-sliced, then released.

const CHUNK_TRIGGER_SECONDS = 6 * 60;
const CHUNK_TARGET_SECONDS = 5 * 60;
const CHUNK_SEARCH_WINDOW_SECONDS = 15;
const CHUNK_MIN_TAIL_SECONDS = 45;
const GAIN_BOOST_PEAK_THRESHOLD = 0.5;
const GAIN_BOOST_TARGET_PEAK = 0.9;
const GAIN_BOOST_MAX_MULTIPLIER = 8;
const TARGET_SAMPLE_RATE = 16000;

function getAudioContextClass() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function getOfflineAudioContextClass() {
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

export async function decodeAudioSource(blob) {
  return decodeAudioBlob(blob);
}

async function decodeAudioBlob(blob) {
  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) return null;
  let context;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    context = new AudioContextClass();
    return await context.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  } finally {
    context?.close().catch(() => {});
  }
}

function getMonoSamplesForAnalysis(buffer) {
  const { numberOfChannels, length } = buffer;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / numberOfChannels;
  }
  return mono;
}

function computePeakAmplitude(buffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

function computeGainMultiplier(buffer) {
  const peak = computePeakAmplitude(buffer);
  if (!peak || peak >= GAIN_BOOST_PEAK_THRESHOLD) return 1;
  return Math.min(GAIN_BOOST_TARGET_PEAK / peak, GAIN_BOOST_MAX_MULTIPLIER);
}

function findQuietSplitSample(mono, sampleRate, targetSeconds) {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.05));
  const centerSample = Math.round(targetSeconds * sampleRate);
  const searchRadius = Math.round(CHUNK_SEARCH_WINDOW_SECONDS * sampleRate);
  const start = Math.max(windowSize, centerSample - searchRadius);
  const end = Math.min(mono.length - windowSize, centerSample + searchRadius);
  if (start >= end) return Math.min(Math.max(centerSample, 0), mono.length);

  let bestSample = centerSample;
  let bestEnergy = Infinity;
  for (let sample = start; sample <= end; sample += windowSize) {
    let sum = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const value = mono[sample + i] || 0;
      sum += value * value;
    }
    const energy = sum / windowSize;
    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestSample = sample;
    }
  }
  return bestSample;
}

function computeChunkBoundarySamples(buffer) {
  const duration = buffer.duration;
  if (duration <= CHUNK_TRIGGER_SECONDS) return [0, buffer.length];

  const mono = getMonoSamplesForAnalysis(buffer);
  const boundaries = [0];
  let target = CHUNK_TARGET_SECONDS;
  while (target < duration - CHUNK_MIN_TAIL_SECONDS) {
    const splitSample = findQuietSplitSample(mono, buffer.sampleRate, target);
    const previous = boundaries[boundaries.length - 1];
    if (splitSample > previous) boundaries.push(splitSample);
    target += CHUNK_TARGET_SECONDS;
  }
  boundaries.push(buffer.length);
  return boundaries;
}

function sliceBuffer(buffer, startSample, endSample) {
  const length = Math.max(1, endSample - startSample);
  const sliced = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    sliced.copyToChannel(buffer.getChannelData(channel).subarray(startSample, endSample), channel);
  }
  return sliced;
}

async function resampleToMono16k(buffer) {
  const OfflineAudioContextClass = getOfflineAudioContextClass();
  if (!OfflineAudioContextClass) return buffer;
  const targetLength = Math.max(1, Math.ceil(buffer.duration * TARGET_SAMPLE_RATE));
  const offlineContext = new OfflineAudioContextClass(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offlineContext.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineContext.destination);
  source.start(0);
  return offlineContext.startRendering();
}

function encodeWavBlob(buffer, gainMultiplier = 1) {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) channelData.push(buffer.getChannelData(channel));

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i] * gainMultiplier));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function boundariesToChunkPlans(boundarySamples, sampleRate) {
  const chunks = [];
  for (let i = 0; i < boundarySamples.length - 1; i += 1) {
    const startSample = boundarySamples[i];
    const endSample = boundarySamples[i + 1];
    chunks.push({
      index: i,
      startSample,
      endSample,
      startSeconds: startSample / sampleRate,
      endSeconds: endSample / sampleRate,
    });
  }
  return chunks;
}

// Record quiet-cut boundaries only; no audio is encoded here.
export async function planAudioChunks(blob, options = {}) {
  const buffer = options.decodedBuffer || await decodeAudioBlob(blob);
  if (!buffer) {
    return {
      durationSeconds: 0,
      usedChunking: false,
      canDecode: false,
      chunks: [{ index: 0, startSample: 0, endSample: 0, startSeconds: 0, endSeconds: 0 }],
    };
  }

  const boundarySamples = computeChunkBoundarySamples(buffer);
  const usedChunking = boundarySamples.length > 2;
  const chunks = boundariesToChunkPlans(boundarySamples, buffer.sampleRate);
  const durationSeconds = buffer.duration;
  return {
    durationSeconds,
    usedChunking,
    canDecode: true,
    sampleRate: buffer.sampleRate,
    chunks,
  };
}

// Encode a single planned chunk (re-decoding the source unless a decoded
// buffer is passed in). Callers should await
// one chunk at a time and not keep every returned blob around longer than needed.
export async function buildChunkAudioBlob(sourceBlob, chunkPlan, options = {}) {
  const fallbackMime = options.fallbackMimeType || sourceBlob?.type || "";
  const buffer = options.decodedBuffer || await decodeAudioBlob(sourceBlob);
  if (!buffer || !chunkPlan) {
    return {
      blob: sourceBlob,
      mimeType: fallbackMime,
      usedGainBoost: false,
      usedOriginal: true,
    };
  }

  const usedChunking = options.usedChunking === true;
  const startSample = Number(chunkPlan.startSample) || 0;
  const endSample = Number(chunkPlan.endSample) || buffer.length;
  const segment = usedChunking || (startSample > 0 || endSample < buffer.length)
    ? sliceBuffer(buffer, startSample, Math.min(endSample, buffer.length))
    : buffer;
  const gainMultiplier = computeGainMultiplier(segment);

  if (!usedChunking && gainMultiplier === 1 && startSample === 0 && endSample >= buffer.length) {
    return {
      blob: sourceBlob,
      mimeType: fallbackMime,
      usedGainBoost: false,
      usedOriginal: true,
    };
  }

  const resampled = await resampleToMono16k(segment);
  const chunkBlob = encodeWavBlob(resampled, gainMultiplier);
  return {
    blob: chunkBlob,
    mimeType: "audio/wav",
    usedGainBoost: gainMultiplier > 1,
    usedOriginal: false,
  };
}

// Back-compat helper used by older call sites / tests: builds every chunk up
// front. Prefer planAudioChunks + buildChunkAudioBlob for memory-sensitive flows.
export async function prepareAudioForTranscription(blob) {
  const plan = await planAudioChunks(blob);
  if (!plan.canDecode) {
    return {
      chunks: [{ blob, mimeType: blob.type || "" }],
      usedChunking: false,
      usedGainBoost: false,
      plan,
    };
  }

  const chunks = [];
  let usedGainBoost = false;
  for (const chunkPlan of plan.chunks) {
    const built = await buildChunkAudioBlob(blob, chunkPlan, {
      usedChunking: plan.usedChunking,
      fallbackMimeType: blob.type || "",
    });
    if (built.usedGainBoost) usedGainBoost = true;
    chunks.push({ blob: built.blob, mimeType: built.mimeType });
  }
  return { chunks, usedChunking: plan.usedChunking, usedGainBoost, plan };
}
