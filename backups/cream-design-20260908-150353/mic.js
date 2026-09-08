const EX_VOLUME_THRESHOLD = 0.7;
const MIC_SPEECH_ONSET_THRESHOLD = 0.01;
const MIC_SILENCE_FRAME_COUNT = 10;
const MIC_MIN_FREQUENCY = 80;
const MIC_MAX_FREQUENCY = 1000;
const MIC_TONE_SILENCE_THRESHOLD = 0.025;
const MIC_AUTOCORRELATION_THRESHOLD = 0.35;

let micAudioContext = null;
let micAnalyser = null;
let micDataArray = null;
let micSource = null;
let micStream = null;
let micVolume = 0;
let micMeterRunning = false;
let micMeterInitialized = false;
let micSensitivity = 1.5;
let micVolumeHistory = [];
let micMaxVolume = 0;
let micNoiseFloor = 0.002;
let micCalibrating = false;
let micVolumeCollectionActive = false;
let micToneFrequency = null;
let micToneLabel = '音声なし';
let micIntonation = 0;
let micSpeechDetected = false;
let micSilenceFrames = 0;
let micIntonationFinalized = false;

function calculateMicIntonation(history) {
    const speechHistory = history.filter((value) => value > MIC_SPEECH_ONSET_THRESHOLD);
    if (speechHistory.length < 2) return 0;
    const average = speechHistory.reduce((sum, value) => sum + value, 0) / speechHistory.length;
    const variance = speechHistory.reduce((sum, value) => sum + (value - average) ** 2, 0) / speechHistory.length;
    return Math.sqrt(variance);
}

function finalizeMicIntonation() {
    if (!micSpeechDetected || micIntonationFinalized) return;
    micIntonation = calculateMicIntonation(micVolumeHistory);
    micIntonationFinalized = true;
    const intonationValue = document.getElementById('mic-intonation-value');
    if (intonationValue) intonationValue.textContent = micIntonation.toFixed(3);
}

function estimateMicTone(data, sampleRate, rms) {
    if (rms < Math.max(MIC_TONE_SILENCE_THRESHOLD, micNoiseFloor * 2)) {
        return null;
    }

    const minLag = Math.floor(sampleRate / MIC_MAX_FREQUENCY);
    const maxLag = Math.min(Math.floor(sampleRate / MIC_MIN_FREQUENCY), data.length - 1);
    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let correlation = 0;
        let energyA = 0;
        let energyB = 0;
        for (let i = 0; i < data.length - lag; i++) {
            const current = data[i];
            const delayed = data[i + lag];
            correlation += current * delayed;
            energyA += current * current;
            energyB += delayed * delayed;
        }
        const normalizedCorrelation = correlation / Math.sqrt(energyA * energyB || 1);
        if (normalizedCorrelation > bestCorrelation) {
            bestCorrelation = normalizedCorrelation;
            bestLag = lag;
        }
    }

    if (bestLag < 0 || bestCorrelation < MIC_AUTOCORRELATION_THRESHOLD) {
        return null;
    }
    return sampleRate / bestLag;
}

function getMicToneLabel(frequency) {
    if (frequency < 100) return '低音';
    if (frequency < 200) return '中音';
    return '高音';
}

function updateMicMeter() {
    const meterFill = document.getElementById('mic-meter-fill');
    const meterValue = document.getElementById('mic-meter-value');
    const toneFrequency = document.getElementById('mic-tone-frequency');
    const toneLabel = document.getElementById('mic-tone-label');
    if (!meterFill || !meterValue) return;

    if (!micAnalyser || !micDataArray) {
        meterFill.style.width = '0%';
        meterValue.textContent = '0.00';
        if (toneFrequency) toneFrequency.textContent = '-- Hz';
        if (toneLabel) toneLabel.textContent = '音声なし';
        const intonationValue = document.getElementById('mic-intonation-value');
        if (intonationValue) intonationValue.textContent = micIntonation.toFixed(3);
        return;
    }

    micAnalyser.getFloatTimeDomainData(micDataArray);
    let sumSquares = 0;
    for (let i = 0; i < micDataArray.length; i++) {
        sumSquares += micDataArray[i] * micDataArray[i];
    }
    const rms = Math.sqrt(sumSquares / micDataArray.length);
    const adjusted = Math.max(0, rms - micNoiseFloor) * micSensitivity;
    micVolume = Math.min(1, Math.max(0, 1 - Math.exp(-adjusted * 3)));
    micToneFrequency = estimateMicTone(micDataArray, micAudioContext.sampleRate, rms);
    micToneLabel = micToneFrequency === null ? '音声なし' : getMicToneLabel(micToneFrequency);
    if (micVolumeCollectionActive) {
        micMaxVolume = Math.max(micMaxVolume, micVolume);
        if (!micSpeechDetected) {
            if (micVolume >= MIC_SPEECH_ONSET_THRESHOLD) {
                micSpeechDetected = true;
                micVolumeHistory = [micVolume];
            }
        } else if (!micIntonationFinalized) {
            micVolumeHistory.push(micVolume);
            if (micVolume <= MIC_SPEECH_ONSET_THRESHOLD) {
                micSilenceFrames++;
                if (micSilenceFrames >= MIC_SILENCE_FRAME_COUNT) {
                    finalizeMicIntonation();
                }
            } else {
                micSilenceFrames = 0;
            }
        }
    }

    meterFill.style.width = `${micVolume * 100}%`;
    meterValue.textContent = micVolume.toFixed(2);
    if (toneFrequency) toneFrequency.textContent = micToneFrequency === null ? '-- Hz' : `${micToneFrequency.toFixed(1)} Hz`;
    if (toneLabel) toneLabel.textContent = micToneLabel;
    const intonationValue = document.getElementById('mic-intonation-value');
    if (intonationValue) intonationValue.textContent = micIntonation.toFixed(3);

    if (micMeterRunning) requestAnimationFrame(updateMicMeter);
}

window.getMicData = function () {
    return {
        volume: micVolume,
        toneFrequency: micToneFrequency,
        toneLabel: micToneLabel,
        intonation: micIntonation,
    };
};

window.startMicVolumeCollection = function () {
    micVolumeHistory = [];
    micMaxVolume = 0;
    micIntonation = 0;
    micSpeechDetected = false;
    micSilenceFrames = 0;
    micIntonationFinalized = false;
    micVolumeCollectionActive = true;
};

window.stopMicVolumeCollection = function () {
    finalizeMicIntonation();
    micVolumeCollectionActive = false;
};

async function calibrateMic() {
    const calibrateButton = document.getElementById('mic-calibrate-btn');
    const noiseFloorStatus = document.getElementById('mic-noise-floor');
    if (!micAnalyser || !micDataArray || micCalibrating) return;

    micCalibrating = true;
    calibrateButton.disabled = true;
    noiseFloorStatus.textContent = 'ノイズフロア: 較正中...静かにしてください';
    const samples = [];
    const sampleInterval = setInterval(() => {
        micAnalyser.getFloatTimeDomainData(micDataArray);
        let sumSquares = 0;
        for (let i = 0; i < micDataArray.length; i++) {
            sumSquares += micDataArray[i] * micDataArray[i];
        }
        samples.push(Math.sqrt(sumSquares / micDataArray.length));
    }, 50);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    clearInterval(sampleInterval);
    micNoiseFloor = (samples.reduce((sum, sample) => sum + sample, 0) / samples.length) * 1.3;
    noiseFloorStatus.textContent = `ノイズフロア: ${micNoiseFloor.toFixed(4)} (較正済み)`;
    calibrateButton.disabled = false;
    micCalibrating = false;
}

async function initMicMeter() {
    if (micMeterInitialized) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        micSource = micAudioContext.createMediaStreamSource(micStream);
        micAnalyser = micAudioContext.createAnalyser();
        micAnalyser.fftSize = 2048;
        micAnalyser.smoothingTimeConstant = 0.1;
        micSource.connect(micAnalyser);
        micDataArray = new Float32Array(micAnalyser.fftSize);
        micMeterRunning = true;
        micMeterInitialized = true;

        const status = document.getElementById('mic-status');
        const startButton = document.getElementById('mic-start-btn');
        const calibrateButton = document.getElementById('mic-calibrate-btn');
        if (status) status.textContent = 'マイク接続中 - 声を出してみてください';
        if (startButton) startButton.disabled = true;
        if (calibrateButton) calibrateButton.disabled = false;
        updateMicMeter();
    } catch (error) {
        const status = document.getElementById('mic-status');
        if (status) status.textContent = `マイクへのアクセスに失敗しました: ${error.message}`;
        console.warn('マイクメーター初期化失敗:', error);
    }
}

function stopMicMeter() {
    micMeterRunning = false;
    micMeterInitialized = false;
    if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
        micStream = null;
    }
    if (micAudioContext) {
        micAudioContext.close();
        micAudioContext = null;
    }
    micSource = null;
    micAnalyser = null;
    micDataArray = null;
    micVolume = 0;
    micToneFrequency = null;
    micToneLabel = '音声なし';
    const startButton = document.getElementById('mic-start-btn');
    const calibrateButton = document.getElementById('mic-calibrate-btn');
    if (startButton) startButton.disabled = false;
    if (calibrateButton) calibrateButton.disabled = true;
}

const micSensitivitySlider = document.getElementById('mic-sensitivity-slider');
const micSensitivityValue = document.getElementById('mic-sensitivity-value');
const micStartButton = document.getElementById('mic-start-btn');
const micCalibrateButton = document.getElementById('mic-calibrate-btn');

if (micStartButton) micStartButton.addEventListener('click', initMicMeter);
if (micCalibrateButton) micCalibrateButton.addEventListener('click', calibrateMic);
if (micSensitivitySlider && micSensitivityValue) {
    micSensitivitySlider.addEventListener('input', () => {
        micSensitivity = parseFloat(micSensitivitySlider.value);
        micSensitivityValue.textContent = micSensitivity.toFixed(1);
    });
}

window.addEventListener('beforeunload', stopMicMeter);
