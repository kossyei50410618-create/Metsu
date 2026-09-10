// 音量判定に使う基準値（現在のコードでは未使用）
const EX_VOLUME_THRESHOLD = 0.7;

// 「発話が始まった」と判断する音量のしきい値
const MIC_SPEECH_ONSET_THRESHOLD = 0.01;

// この回数連続で小さい音量なら「発話終了」と判断する
const MIC_SILENCE_FRAME_COUNT = 10;

// 声の高さ（基本周波数）として調べる最低周波数 [Hz]
const MIC_MIN_FREQUENCY = 80;

// 声の高さ（基本周波数）として調べる最高周波数 [Hz]
const MIC_MAX_FREQUENCY = 1000;

// これより音が小さい場合は声の高さを判定しない
const MIC_TONE_SILENCE_THRESHOLD = 0.025;

// 声らしい周期性があるかを判断する相関の基準値
const MIC_AUTOCORRELATION_THRESHOLD = 0.35;


// ==============================
// マイク関連の変数
// ==============================

// Web Audio APIで音声を処理するための環境
let micAudioContext = null;

// 音声波形を解析するためのAnalyserNode
let micAnalyser = null;

// マイクから取得した音声データを入れる配列
let micDataArray = null;

// マイク入力の音声ソース
let micSource = null;

// マイクの入力ストリーム
let micStream = null;

// 現在の音量
let micVolume = 0;

// 音量メーターが動作中か
let micMeterRunning = false;

// マイクが初期化済みか
let micMeterInitialized = false;
let micSensitivity = 0.8;
let micVolumeHistory = [];

// 発話中の声の高さを記録する配列
let micToneHistory = [];

// 発話中の最大音量
let micMaxVolume = 0;

// 周囲の環境音の大きさ
let micNoiseFloor = 0.002;

// ノイズフロアの較正中か
let micCalibrating = false;

// 発話データの収集を行っているか
let micVolumeCollectionActive = false;

// 現在検出されている声の高さ [Hz]
let micToneFrequency = null;

// 声の高さを「低音・中音・高音」で表したもの
let micToneLabel = '音声なし';

// 発話の抑揚の大きさ
let micIntonation = 0;

// 発話が検出されたか
let micSpeechDetected = false;

// 無音状態が何フレーム続いているか
let micSilenceFrames = 0;

// 抑揚の計算が完了したか
let micIntonationFinalized = false;


// ==============================
// 抑揚の計算
// ==============================

// 発話中の音量のばらつきから、声の抑揚の大きさを計算する
function calculateMicIntonation(history) {

    // 発話と判断できる音量だけを取り出す
    const speechHistory = history.filter(
        (value) => value > MIC_SPEECH_ONSET_THRESHOLD
    );

    // データが2個未満なら計算できない
    if (speechHistory.length < 2) return 0;

    // 発話中の平均音量を求める
    const average =
        speechHistory.reduce((sum, value) => sum + value, 0)
        / speechHistory.length;

    // 平均からどれくらい音量が変化したか（分散）を求める
    const variance =
        speechHistory.reduce(
            (sum, value) => sum + (value - average) ** 2,
            0
        ) / speechHistory.length;

    // 分散の平方根＝音量のばらつき（標準偏差）を
    // 抑揚の大きさとして返す
    return Math.sqrt(variance);
}


// 発話が終わったときに抑揚の計算結果を確定する
function finalizeMicIntonation() {

    // 発話が検出されていない、
    // またはすでに計算済みなら何もしない
    if (!micSpeechDetected || micIntonationFinalized) return;

    // 発話中に記録した音量から抑揚を計算
    micIntonation = calculateMicIntonation(micVolumeHistory);

    // 計算済みとして記録
    micIntonationFinalized = true;

    // HTML側の抑揚表示を更新
    const intonationValue =
        document.getElementById('mic-intonation-value');

    if (intonationValue) {
        intonationValue.textContent = micIntonation.toFixed(3);
    }
}


// ==============================
// 声の高さ（周波数）の推定
// ==============================

// 音声データから声の高さ（基本周波数）を推定する
function estimateMicTone(data, sampleRate, rms) {

    // 音が小さすぎる場合は声の高さを判定しない
    if (
        rms <
        Math.max(
            MIC_TONE_SILENCE_THRESHOLD,
            micNoiseFloor * 2
        )
    ) {
        return null;
    }


    // 周波数を「周期（lag）」に変換して、
    // 調べる範囲を決める

    // 1000Hzに対応する最小の周期
    const minLag =
        Math.floor(sampleRate / MIC_MAX_FREQUENCY);

    // 80Hzに対応する最大の周期
    const maxLag =
        Math.min(
            Math.floor(sampleRate / MIC_MIN_FREQUENCY),
            data.length - 1
        );


    // 一番周期性が強かった位置
    let bestLag = -1;

    // 一番高かった相関値
    let bestCorrelation = 0;


    // 調べる周期を1つずつ変えて確認する
    for (let lag = minLag; lag <= maxLag; lag++) {

        let correlation = 0;
        let energyA = 0;
        let energyB = 0;


        // 現在の波形と、少しずらした波形を比較する
        for (let i = 0; i < data.length - lag; i++) {

            const current = data[i];
            const delayed = data[i + lag];

            // 2つの波形の似ている度合いを計算するための値
            correlation += current * delayed;

            // 元の波形のエネルギー
            energyA += current * current;

            // ずらした波形のエネルギー
            energyB += delayed * delayed;
        }


        // 波形を少しずらしたときの
        // 「似ている度合い」を計算
        const normalizedCorrelation =
            correlation /
            Math.sqrt(energyA * energyB || 1);


        // 今までより相関が高ければ記録
        if (normalizedCorrelation > bestCorrelation) {
            bestCorrelation = normalizedCorrelation;
            bestLag = lag;
        }
    }


    // 周期性が弱すぎる場合は
    // 声の高さを正しく判定できなかったと判断
    if (
        bestLag < 0 ||
        bestCorrelation < MIC_AUTOCORRELATION_THRESHOLD
    ) {
        return null;
    }


    // 周期から周波数（Hz）に戻す
    return sampleRate / bestLag;
}


// ==============================
// 声の高さを分類
// ==============================

// 周波数を「低音・中音・高音」の3段階に分類する
function getMicToneLabel(frequency) {

    // 100Hz未満 → 低音
    if (frequency < 100) return '低音';

    // 100Hz以上200Hz未満 → 中音
    if (frequency < 200) return '中音';

    // 200Hz以上 → 高音
    return '高音';
}


// ==============================
// マイク入力のリアルタイム解析
// ==============================

// マイク入力を繰り返し解析し、
// 音量・声の高さ・抑揚を画面に反映する
function updateMicMeter() {

    // HTMLから音量メーターなどの表示部分を取得
    const meterFill =
        document.getElementById('mic-meter-fill');

    const meterValue =
        document.getElementById('mic-meter-value');

    const toneFrequency =
        document.getElementById('mic-tone-frequency');

    const toneLabel =
        document.getElementById('mic-tone-label');


    // 必要なHTML要素がなければ処理を終了
    if (!meterFill || !meterValue) return;


    // マイクがまだ準備できていない場合
    if (!micAnalyser || !micDataArray) {

        // 音量を0にする
        meterFill.style.width = '0%';
        meterValue.textContent = '0.00';

        // 声の高さをリセット
        if (toneFrequency) {
            toneFrequency.textContent = '-- Hz';
        }

        // 音声なしと表示
        if (toneLabel) {
            toneLabel.textContent = '音声なし';
        }

        // 抑揚の表示
        const intonationValue =
            document.getElementById('mic-intonation-value');

        if (intonationValue) {
            intonationValue.textContent =
                micIntonation.toFixed(3);
        }

        return;
    }


    // ==========================
    // 現在の音声波形を取得
    // ==========================

    // マイクから現在の音声波形を取得
    micAnalyser.getFloatTimeDomainData(micDataArray);


    // 音声データの二乗の合計(符号によらない)　→　RMS(実効値)を取得している
    let sumSquares = 0;

    for (let i = 0; i < micDataArray.length; i++) {
        sumSquares +=
            micDataArray[i] * micDataArray[i];
    }


    // ==========================
    // 音量を計算
    // ==========================

    // RMS（二乗平均平方根）から現在の音量を求める
    const rms =
        Math.sqrt(
            sumSquares / micDataArray.length
        );


    // 環境音（ノイズ）を引き、
    // マイク感度をかけて音量を調整
    const adjusted =
        Math.max(0, rms - micNoiseFloor)
        * micSensitivity;


    // 調整した音量を0～1の範囲に変換
    micVolume =
        Math.min(
            1,
            Math.max(
                0,
                1 - Math.exp(-adjusted * 3)
            )
        );


    // ==========================
    // 声の高さを計算
    // ==========================

    // 現在の音声から声の高さを推定
    micToneFrequency =
        estimateMicTone(
            micDataArray,
            micAudioContext.sampleRate,
            rms
        );


    // 周波数を「低音・中音・高音」に分類
    micToneLabel =
        micToneFrequency === null
            ? '音声なし'
            : getMicToneLabel(micToneFrequency);


    // ==========================
    // 発話データの記録
    // ==========================

    // 発話データを収集中の場合だけ記録する
    if (micVolumeCollectionActive) {

        // 今までの最大音量を更新
        micMaxVolume =
            Math.max(micMaxVolume, micVolume);


        // まだ発話が始まっていない場合
        if (!micSpeechDetected) {

            // 音量がしきい値以上になったら
            // 「発話開始」と判断
            if (
                micVolume >=
                MIC_SPEECH_ONSET_THRESHOLD
            ) {
                micSpeechDetected = true;

                // 発話開始時の音量を記録
                micVolumeHistory = [micVolume];
            }

        // 発話中で、まだ抑揚の計算が終わっていない場合
        } else if (!micIntonationFinalized) {

            // 発話中の音量を保存して、
            // あとで抑揚を計算する
            micVolumeHistory.push(micVolume);


            // 音量がしきい値以下なら無音として扱う
            if (
                micVolume <=
                MIC_SPEECH_ONSET_THRESHOLD
            ) {

                // 無音フレーム数を増やす
                micSilenceFrames++;


                // 一定回数連続で無音なら
                // 「発話終了」と判断
                if (
                    micSilenceFrames >=
                    MIC_SILENCE_FRAME_COUNT
                ) {
                    finalizeMicIntonation();
                }

            } else {

                // 声が出ているので無音カウントをリセット
                micSilenceFrames = 0;
            }
        }


        // 声の高さが検出できた場合
        if (micToneFrequency !== null) {

            // 発話中の声の高さを保存して、
            // あとで平均を求める
            micToneHistory.push(
                micToneFrequency
            );
        }
    }


    // ==========================
    // 画面表示を更新
    // ==========================

    // 音量メーターの横幅を更新
    meterFill.style.width =
        `${micVolume * 100}%`;

    // 数値として音量を表示
    meterValue.textContent =
        micVolume.toFixed(2);


    // 声の高さを表示
    if (toneFrequency) {
        toneFrequency.textContent =
            micToneFrequency === null
                ? '-- Hz'
                : `${micToneFrequency.toFixed(1)} Hz`;
    }


    // 「低音・中音・高音」を表示
    if (toneLabel) {
        toneLabel.textContent = micToneLabel;
    }


    // 抑揚の数値を表示
    const intonationValue =
        document.getElementById('mic-intonation-value');

    if (intonationValue) {
        intonationValue.textContent =
            micIntonation.toFixed(3);
    }


    // マイクメーターが動作中なら
    // 次のフレームでも解析を行う
    if (micMeterRunning) {
        requestAnimationFrame(updateMicMeter);
    }
}


// ==============================
// 現在のマイクデータを取得
// ==============================

// 現在のマイク情報を他のプログラムから取得できるようにする
window.getMicData = function () {

    return {
        // 現在の音量
        volume: micVolume,

        // 現在の声の高さ
        toneFrequency: micToneFrequency,

        // 低音・中音・高音
        toneLabel: micToneLabel,

        // 抑揚
        intonation: micIntonation,
    };
};


// ==============================
// 発話データの収集開始
// ==============================

// 1回の発話について
// 音量・声の高さの記録を開始する
window.startMicVolumeCollection = function () {

    // 過去の記録をリセット
    micVolumeHistory = [];
    micToneHistory = [];

    // 最大音量をリセット
    micMaxVolume = 0;

    // 抑揚をリセット
    micIntonation = 0;

    // 発話開始判定をリセット
    micSpeechDetected = false;

    // 無音フレーム数をリセット
    micSilenceFrames = 0;

    // 抑揚計算済みフラグをリセット
    micIntonationFinalized = false;

    // データ収集を開始
    micVolumeCollectionActive = true;
};


// ==============================
// 発話データの収集停止
// ==============================

// 発話の記録を停止し、抑揚を確定する
window.stopMicVolumeCollection = function () {

    // 最後に抑揚を計算
    finalizeMicIntonation();

    // データ収集を停止
    micVolumeCollectionActive = false;
};


// ==============================
// 発話全体の集計結果
// ==============================

// 1回の発話全体の集計結果
// （最大音量・平均音程など）を返す
window.getMicSessionStats = function () {

    // 声の高さのデータがあれば平均を計算
    const avgTone =
        micToneHistory.length > 0
            ? micToneHistory.reduce(
                (sum, f) => sum + f,
                0
            ) / micToneHistory.length
            : null;


    return {

        // 発話中の最大音量
        maxVolume: micMaxVolume,

        // 発話中の平均周波数
        avgTone: avgTone,

        // 平均周波数を低音・中音・高音に分類
        avgToneLabel:
            avgTone === null
                ? '不明'
                : getMicToneLabel(avgTone),

        // 声の高さを取得できた回数
        toneSampleCount: micToneHistory.length,
    };
};


// ==============================
// ノイズフロアの較正
// ==============================

// 周囲の環境音を測定して、
// マイクのノイズ基準値を調整する
async function calibrateMic() {

    // 較正ボタンを取得
    const calibrateButton =
        document.getElementById('mic-calibrate-btn');

    // ノイズフロアの表示部分を取得
    const noiseFloorStatus =
        document.getElementById('mic-noise-floor');


    // マイクが準備できていない、
    // またはすでに較正中なら何もしない
    if (
        !micAnalyser ||
        !micDataArray ||
        micCalibrating
    ) {
        return;
    }


    // 較正中フラグをON
    micCalibrating = true;

    // 較正ボタンを無効化
    calibrateButton.disabled = true;

    // 画面に較正中であることを表示
    noiseFloorStatus.textContent =
        'ノイズフロア: 較正中...静かにしてください';


    // 周囲の音量データを保存する配列
    const samples = [];


    // 50msごとに周囲の音を測定
    const sampleInterval = setInterval(() => {

        // マイクから現在の音声波形を取得
        micAnalyser.getFloatTimeDomainData(
            micDataArray
        );


        // 音声データの二乗の合計
        let sumSquares = 0;


        for (
            let i = 0;
            i < micDataArray.length;
            i++
        ) {
            sumSquares +=
                micDataArray[i] *
                micDataArray[i];
        }


        // RMSを計算して保存
        samples.push(
            Math.sqrt(
                sumSquares / micDataArray.length
            )
        );

    }, 50);


    // 1秒間測定する
    await new Promise(
        (resolve) => setTimeout(resolve, 1000)
    );


    // 測定を終了
    clearInterval(sampleInterval);


    // 測定した平均値をノイズフロアとして設定
    // 1.3倍して少し余裕を持たせている
    micNoiseFloor =
        (
            samples.reduce(
                (sum, sample) => sum + sample,
                0
            ) / samples.length
        ) * 1.3;


    // 較正結果を画面に表示
    noiseFloorStatus.textContent =
        `ノイズフロア: ${micNoiseFloor.toFixed(4)} (較正済み)`;


    // 較正ボタンを再び有効化
    calibrateButton.disabled = false;

    // 較正終了
    micCalibrating = false;
}


// ==============================
// マイクの初期化
// ==============================

// マイクを取得し、
// Web Audio APIの解析環境を初期化する
async function initMicMeter() {

    // すでに初期化済みなら何もしない
    if (micMeterInitialized) return;


    // ブラウザがマイク入力に対応していなければ終了
    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        return;
    }


    try {

        // ブラウザからマイク使用の許可を取得
        micStream =
            await navigator.mediaDevices.getUserMedia({
                audio: true
            });


        // Web Audio APIの音声処理環境を作成
        micAudioContext =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();


        // マイク入力をAudioContextに接続
        micSource =
            micAudioContext.createMediaStreamSource(
                micStream
            );


        // 音声波形を解析するAnalyserNodeを作成
        micAnalyser =
            micAudioContext.createAnalyser();


        // 解析する音声データのサイズを設定
        micAnalyser.fftSize = 2048;


        // 音量の変化をどの程度滑らかにするか
        micAnalyser.smoothingTimeConstant = 0.1;


        // マイク入力をAnalyserNodeに接続
        micSource.connect(micAnalyser);


        // 音声データを保存する配列を作成
        micDataArray =
            new Float32Array(
                micAnalyser.fftSize
            );


        // 音量メーターの更新を開始
        micMeterRunning = true;

        // 初期化完了
        micMeterInitialized = true;


        // ==========================
        // HTMLの表示を更新
        // ==========================

        const status =
            document.getElementById('mic-status');

        const startButton =
            document.getElementById('mic-start-btn');

        const calibrateButton =
            document.getElementById('mic-calibrate-btn');


        // マイク接続中と表示
        if (status) {
            status.textContent =
                'マイク接続中 - 声を出してみてください';
        }


        // スタートボタンを無効化
        if (startButton) {
            startButton.disabled = true;
        }


        // 較正ボタンを有効化
        if (calibrateButton) {
            calibrateButton.disabled = false;
        }


        // 音量メーターの更新を開始
        updateMicMeter();


    } catch (error) {

        // マイクへのアクセスに失敗した場合
        const status =
            document.getElementById('mic-status');


        if (status) {
            status.textContent =
                `マイクへのアクセスに失敗しました: ${error.message}`;
        }


        // コンソールにもエラーを表示
        console.warn(
            'マイクメーター初期化失敗:',
            error
        );
    }
}


// ==============================
// マイクの停止
// ==============================

// マイクとAudioContextを停止して、
// 使用したリソースを解放する
function stopMicMeter() {

    // メーターの更新を停止
    micMeterRunning = false;

    // 初期化済みフラグをOFF
    micMeterInitialized = false;


    // マイクのストリームが存在する場合
    if (micStream) {

        // マイクの録音トラックをすべて停止
        micStream
            .getTracks()
            .forEach(
                (track) => track.stop()
            );

        // ストリームを削除
        micStream = null;
    }


    // AudioContextが存在する場合
    if (micAudioContext) {

        // AudioContextを閉じる
        micAudioContext.close();

        // 変数をリセット
        micAudioContext = null;
    }


    // マイク関連の変数をリセット
    micSource = null;
    micAnalyser = null;
    micDataArray = null;

    // 音量をリセット
    micVolume = 0;

    // 声の高さをリセット
    micToneFrequency = null;

    // 声の高さの表示をリセット
    micToneLabel = '音声なし';


    // HTMLのボタンを取得
    const startButton =
        document.getElementById('mic-start-btn');

    const calibrateButton =
        document.getElementById('mic-calibrate-btn');


    // スタートボタンを再び有効化
    if (startButton) {
        startButton.disabled = false;
    }


    // 較正ボタンを無効化
    if (calibrateButton) {
        calibrateButton.disabled = true;
    }
}


// ==============================
// HTML要素の取得
// ==============================

// マイク感度スライダー
const micSensitivitySlider =
    document.getElementById(
        'mic-sensitivity-slider'
    );

// マイク感度の数値表示
const micSensitivityValue =
    document.getElementById(
        'mic-sensitivity-value'
    );

// マイク開始ボタン
const micStartButton =
    document.getElementById(
        'mic-start-btn'
    );

// ノイズ較正ボタン
const micCalibrateButton =
    document.getElementById(
        'mic-calibrate-btn'
    );


// ==============================
// ボタン・スライダーのイベント
// ==============================

// マイク開始ボタンが押されたら
// マイクの初期化を行う
if (micStartButton) {
    micStartButton.addEventListener(
        'click',
        initMicMeter
    );
}


// 較正ボタンが押されたら
// ノイズフロアの較正を行う
if (micCalibrateButton) {
    micCalibrateButton.addEventListener(
        'click',
        calibrateMic
    );
}


// マイク感度スライダーが存在する場合
if (
    micSensitivitySlider &&
    micSensitivityValue
) {

    // スライダーを動かしたとき
    micSensitivitySlider.addEventListener(
        'input',
        () => {

            // スライダーの値を数値として取得
            micSensitivity =
                parseFloat(
                    micSensitivitySlider.value
                );


            // 現在の感度を画面に表示
            micSensitivityValue.textContent =
                micSensitivity.toFixed(1);
        }
    );
}


// ==============================
// ページを閉じるときの処理
// ==============================

// ページを閉じたり移動したりするときに
// マイクを停止してリソースを解放する
window.addEventListener(
    'beforeunload',
    stopMicMeter
);