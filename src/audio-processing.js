// Client-side audio pre-processing to make Gemini transcription more reliable
// for long recordings and for quiet/unclear audio.
//
// Two independent improvements live here:
//
// 1. Chunking - long recordings are split into shorter pieces before being
//    sent to Gemini, one request per piece. A single multi-hour request is
//    more likely to time out, get truncated, or have Gemini silently drop or
//    hallucinate parts of the middle of the recording; several short requests
//    are each easier for the model to fully process. Cuts are placed at the
//    quietest point near each target boundary (a pause between sentences)
//    instead of at a fixed time, so a chunk boundary should not land in the
//    middle of a word.
//
// 2. Gain boost - if a clip (or one chunk of it) is quiet, its samples are
//    scaled up before sending, similar to a "normalize volume" pass in audio
//    editing software. This directly targets the "เสียงเบา" (quiet audio)
//    complaint - Gemini has an easier time transcribing audio that isn't
//    barely above the noise floor.
//
// Both steps also downsample to 16kHz mono, which is more than enough for
// speech and keeps re-encoded chunks small (comfortably under the inline
// request size limit even for long source recordings).
//
// If the browser can't decode the audio (unsupported codec, corrupt file,
// etc.), everything here fails soft: the original file is sent untouched,
// exactly like before this feature existed.

const CHUNK_TRIGGER_SECONDS = 6 * 60; // only start chunking past this length
const CHUNK_TARGET_SECONDS = 5 * 60; // aim for ~5 minute pieces
const CHUNK_SEARCH_WINDOW_SECONDS = 15; // look this far around the target point for a quiet spot to cut
const CHUNK_MIN_TAIL_SECONDS = 45; // never leave a trailing sliver shorter than this
const GAIN_BOOST_PEAK_THRESHOLD = 0.5; // peak sample amplitude below this counts as "quiet"
const GAIN_BOOST_TARGET_PEAK = 0.9;
const GAIN_BOOST_MAX_MULTIPLIER = 8; // cap so we don't just amplify noise floor on near-silent clips
const TARGET_SAMPLE_RATE = 16000;

function getAudioContextClass() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function getOfflineAudioContextClass() {
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
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

// Finds the sample index nearest `targetSeconds` where short-term volume is
// lowest, searching only within +/- CHUNK_SEARCH_WINDOW_SECONDS, so a cut
// lands in a natural pause instead of mid-word.
function findQuietSplitSample(mono, sampleRate, targetSeconds) {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.05)); // ~50ms
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

// Returns sample-index boundaries (always starting at 0 and ending at
// buffer.length). Two entries means "don't chunk"; more than two means the
// audio was split at `boundaries.length - 1` quiet points.
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

// Renders `buffer` down to mono at TARGET_SAMPLE_RATE using an
// OfflineAudioContext, which also handles any needed resampling.
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
  view.setUint16(20, 1, true); // PCM
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

// Main entry point. Returns: { chunks: [{ blob, mimeType }], usedChunking, usedGainBoost }
export async function prepareAudioForTranscription(blob) {
  const buffer = await decodeAudioBlob(blob);
  if (!buffer) {
    return {
      chunks: [{ blob, mimeType: blob.type || "" }],
      usedChunking: false,
      usedGainBoost: false,
    };
  }

  const boundarySamples = computeChunkBoundarySamples(buffer);
  const usedChunking = boundarySamples.length > 2;
  const chunks = [];
  let usedGainBoost = false;

  for (let i = 0; i < boundarySamples.length - 1; i += 1) {
    const startSample = boundarySamples[i];
    const endSample = boundarySamples[i + 1];
    const segment = usedChunking ? sliceBuffer(buffer, startSample, endSample) : buffer;
    const gainMultiplier = computeGainMultiplier(segment);
    if (gainMultiplier > 1) usedGainBoost = true;

    if (!usedChunking && gainMultiplier === 1) {
      // Nothing to improve here: keep the original file untouched so we don't
      // pay a re-encode cost (or lose the original codec's quality) for the
      // common case of an already short, already clear recording.
      chunks.push({ blob, mimeType: blob.type || "" });
      break;
    }

    const resampled = await resampleToMono16k(segment);
    const chunkBlob = encodeWavBlob(resampled, gainMultiplier);
    chunks.push({ blob: chunkBlob, mimeType: "audio/wav" });
  }

  return { chunks, usedChunking, usedGainBoost };
}
