/**
 * BarcodeBattler2 HTML5 Simulator - Camera & Image Barcode Reader Module
 *
 * 元 ActionScript:
 *   - src/barcode_reader.as (全160行: barcode_reader_init, select_image, file_select,
 *     file_select_complete, image_load_complete, select_imate_input, get_camera,
 *     analyze_bmp_data, card_reader_visible_check, auto_input_check_box_load,
 *     auto_input_check_box_save)
 *   - src/barcode2.as:125-133 (init_card_reader: card_reader_visible トグル)
 *
 * ライセンス方針:
 *   - 完全 MIT ライセンス / 標準 Web API 準拠
 *   - Web 標準 BarcodeDetector API (Chrome/Edge/Android 等のネイティブ ZXing/MLKit) を最優先
 *   - フォールバックに BB2.Cards.decodeEanFromImageData (Pure JS / MIT ライセンスのマルチスキャンデコーダ)
 *   - 外部の非 MIT ライブラリへの依存なし
 */
(function (global) {
  'use strict';

  var BB2 = global.BB2 = global.BB2 || {};
  var Reader = BB2.Reader = {};

  Reader.WIDTH = 320;
  Reader.HEIGHT = 240;

  var currentStream = null;
  var scanTimer = null;
  var lastLoadedImage = null;

  /**
   * ImageData 全体から水平・垂直の複数走査線で EAN-13 / EAN-8 を検出する Pure JS デコーダ
   * @param {ImageData} imageData
   * @returns {string|null} 認識されたバーコード数字文字列 (8桁または13桁) または null
   */
  function scanImageDataMultiLine(imageData) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) return null;
    var w = imageData.width, h = imageData.height;

    /* BB2.Cards が提供する基本デコーダを確認 */
    if (BB2.Cards && typeof BB2.Cards.decodeEanFromImageData === 'function') {
      /* まず全体の中央5ラインデコードを試行 */
      var fastRes = BB2.Cards.decodeEanFromImageData(imageData);
      if (fastRes) return fastRes;
    }

    /* 多段水平スキャン (10%〜90% の範囲を 5% 刻みで走査) */
    var stepY = Math.max(2, Math.floor(h / 20));
    for (var y = Math.floor(h * 0.1); y <= Math.floor(h * 0.9); y += stepY) {
      var rowData = extractRowSubImage(imageData, y, 1);
      if (rowData && BB2.Cards && BB2.Cards.decodeEanFromImageData) {
        var rRes = BB2.Cards.decodeEanFromImageData(rowData);
        if (rRes) return rRes;
      }
    }

    /* 90度回転(縦向きバーコード用)の垂直スキャン (10%〜90% を 5% 刻みで走査) */
    var stepX = Math.max(2, Math.floor(w / 20));
    for (var x = Math.floor(w * 0.1); x <= Math.floor(w * 0.9); x += stepX) {
      var colData = extractColSubImage(imageData, x, 1);
      if (colData && BB2.Cards && BB2.Cards.decodeEanFromImageData) {
        var cRes = BB2.Cards.decodeEanFromImageData(colData);
        if (cRes) return cRes;
      }
    }

    return null;
  }

  function extractRowSubImage(src, y, height) {
    if (typeof ImageData === 'undefined') return null;
    var w = src.width;
    try {
      var canvas = getOffscreenCanvas(w, height);
      var ctx = canvas.getContext('2d');
      var sub = ctx.createImageData(w, height);
      var start = y * w * 4;
      var len = w * height * 4;
      for (var i = 0; i < len; i++) {
        sub.data[i] = src.data[start + i];
      }
      return sub;
    } catch (_) {
      return null;
    }
  }

  function extractColSubImage(src, x, width) {
    if (typeof ImageData === 'undefined') return null;
    var w = src.width, h = src.height;
    try {
      /* 縦ラインを横向き 1D スキャンライン (width=h, height=1) に変換 */
      var canvas = getOffscreenCanvas(h, width);
      var ctx = canvas.getContext('2d');
      var sub = ctx.createImageData(h, width);
      for (var y = 0; y < h; y++) {
        var srcIdx = (y * w + x) * 4;
        var dstIdx = y * 4;
        sub.data[dstIdx] = src.data[srcIdx];
        sub.data[dstIdx + 1] = src.data[srcIdx + 1];
        sub.data[dstIdx + 2] = src.data[srcIdx + 2];
        sub.data[dstIdx + 3] = src.data[srcIdx + 3];
      }
      return sub;
    } catch (_) {
      return null;
    }
  }

  var offscreenCanvas = null;
  function getOffscreenCanvas(w, h) {
    if (!offscreenCanvas) {
      if (typeof document !== 'undefined') {
        offscreenCanvas = document.createElement('canvas');
      } else {
        return null;
      }
    }
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    return offscreenCanvas;
  }

  /**
   * BarcodeDetector API または Pure JS デコーダで ImageData を解析
   * (元 ActionScript: analyze_bmp_data 108-131 相当)
   * @param {ImageData|HTMLCanvasElement|ImageBitmap} source
   * @param {function(string|null):void} callback
   */
  Reader.decodeBarcode = function (source, callback) {
    if (!callback) callback = function () {};

    /* 1. Web 標準 BarcodeDetector API (ZXing/MLKit 等のネイティブ高速認識) */
    if (typeof global.BarcodeDetector !== 'undefined') {
      try {
        var detector = new global.BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
        var detectSource = source;
        if (source instanceof ImageData && typeof OffscreenCanvas !== 'undefined') {
          var oc = new OffscreenCanvas(source.width, source.height);
          var octx = oc.getContext('2d');
          octx.putImageData(source, 0, 0);
          detectSource = oc;
        }
        detector.detect(detectSource).then(function (barcodes) {
          if (barcodes && barcodes.length > 0) {
            for (var i = 0; i < barcodes.length; i++) {
              var val = String(barcodes[i].rawValue || '').replace(/[^0-9]/g, '');
              if (val.length === 8 || val.length === 13) {
                callback(val);
                return;
              }
            }
          }
          /* ネイティブで検出できなかった場合、Pure JS デコーダにフォールバック */
          fallbackPureJs(source, callback);
        }).catch(function () {
          fallbackPureJs(source, callback);
        });
        return;
      } catch (_) {
        /* フォールバックへ */
      }
    }

    fallbackPureJs(source, callback);
  };

  function fallbackPureJs(source, callback) {
    var imgData = null;
    if (source && source.data && source.width && source.height) {
      imgData = source;
    } else if (source && typeof source.getContext === 'function') {
      var ctx = source.getContext('2d');
      imgData = ctx.getImageData(0, 0, source.width, source.height);
    }
    if (!imgData) {
      callback(null);
      return;
    }
    var res = scanImageDataMultiLine(imgData);
    callback(res);
  }

  /**
   * カメラの停止
   */
  Reader.stopCamera = function (videoEl) {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (currentStream) {
      try {
        var tracks = currentStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          tracks[i].stop();
        }
      } catch (_) {}
      currentStream = null;
    }
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.srcObject = null;
      } catch (_) {}
    }
  };

  /**
   * カメラの開始 (元 ActionScript: get_camera 87-106 相当)
   */
  Reader.startCamera = function (videoEl, canvasEl, onDetected, onError) {
    Reader.stopCamera(videoEl);
    lastLoadedImage = null;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      if (onError) onError(new Error('カメラ API (getUserMedia) が利用できません'));
      return;
    }

    var constraints = {
      video: {
        width: { ideal: Reader.WIDTH },
        height: { ideal: Reader.HEIGHT },
        facingMode: 'environment'
      },
      audio: false
    };

    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      currentStream = stream;
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(function () {});
      }
      /* 定期スキャンループ (200ms ごとにフレーム解析) */
      scanTimer = setInterval(function () {
        if (!videoEl || videoEl.readyState < 2) return;
        var ctx = canvasEl ? canvasEl.getContext('2d') : null;
        if (!ctx) return;
        try {
          ctx.drawImage(videoEl, 0, 0, Reader.WIDTH, Reader.HEIGHT);
          var imgData = ctx.getImageData(0, 0, Reader.WIDTH, Reader.HEIGHT);
          Reader.decodeBarcode(imgData, function (code) {
            if (code && onDetected) {
              onDetected(code);
            }
          });
        } catch (_) {}
      }, 200);
    }).catch(function (err) {
      if (onError) onError(err);
    });
  };

  /**
   * リーダー機能の初期化・UI イベントバインド
   * @param {Object} view BB2.View インスタンス
   */
  Reader.init = function (view) {
    var el = view.el;
    if (!el || !el.init_card_reader_button) return;

    var hasDoc = typeof document !== 'undefined';
    var video = el.video_display || (hasDoc ? document.getElementById('video_display') : null);
    var canvas = el.reader_canvas || (hasDoc ? document.getElementById('reader_canvas') : null);
    var fileInput = el.image_file_input || (hasDoc ? document.getElementById('image_file_input') : null);
    var statusEl = el.reader_status || (hasDoc ? document.getElementById('reader_status') : null);

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg || '';
    }

    /**
     * 元 ActionScript: card_reader_visible_check (134-140)
     * auto_input が有効ならリーダを閉じて card_insert を自動実行
     */
    function cardReaderVisibleCheck() {
      if (el.auto_input && el.auto_input.checked) {
        /* リーダを閉じる (元 136-137: card_reader_visible = false; init_card_reader(...)) */
        Reader.card_reader_visible = true; /* 次回トグルで表示できるよう設定 */
        el.camera_reader.hidden = true;
        Reader.stopCamera(video);
        setStatus('');
        /* カード挿入 (元 138: card_insert(new MouseEvent(MouseEvent.CLICK))) */
        if (typeof view.onCardIn === 'function') {
          view.onCardIn();
        }
      }
    }

    /**
     * 元 ActionScript: analyze_bmp_data (108-131)
     */
    function analyzeBmpData(source) {
      setStatus('バーコード解析中...');
      Reader.decodeBarcode(source, function (code) {
        if (code) {
          el.card_in.value = code;
          setStatus('バーコード認識: ' + code);
          view.note('バーコード認識成功: ' + code);
        } else {
          el.card_in.value = '0';
          setStatus('バーコードを検出できませんでした (0)');
          view.note('バーコード認識失敗 (0 を設定)');
        }
        cardReaderVisibleCheck();
      });
    }

    /**
     * 元 ActionScript: init_card_reader (barcode2.as:125-133)
     * private function init_card_reader(event:Event):void{
     *   if(card_reader_visible){
     *     card_reader_visible = false;
     *     camera_reader.visible = true;
     *   }else{
     *     card_reader_visible = true;
     *     camera_reader.visible = false;
     *   }
     * }
     */
    Reader.card_reader_visible = false; /* 初期状態: false -> 初回呼び出しで true (非表示) */
    function toggleCardReader() {
      if (Reader.card_reader_visible) {
        Reader.card_reader_visible = false;
        el.camera_reader.hidden = false;
        setStatus('Ready');
      } else {
        Reader.card_reader_visible = true;
        el.camera_reader.hidden = true;
        Reader.stopCamera(video);
        setStatus('');
      }
    }

    /* 起動時の初期化 (元 barcode2.as:46 init_card_reader 呼び出しで非表示化) */
    toggleCardReader();

    /* CAMERA_IN ボタン */
    view.bind(el.init_card_reader_button, function () {
      toggleCardReader();
      view.note('CAMERA_IN: 面板 ' + (el.camera_reader.hidden ? '非表示' : '表示'));
    });

    /* Image Select ボタン (元 select_image 31-42) */
    view.bind(el.select_image_button, function () {
      Reader.stopCamera(video);
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    });

    /* ファイル選択完了 (元 file_select, file_select_complete, image_load_complete 44-71) */
    if (fileInput && typeof fileInput.addEventListener === 'function') {
      fileInput.addEventListener('change', function (ev) {
        var files = ev.target.files;
        if (!files || files.length === 0) return;
        var file = files[0];
        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            lastLoadedImage = img;
            if (canvas) {
              var ctx = canvas.getContext('2d');
              ctx.clearRect(0, 0, Reader.WIDTH, Reader.HEIGHT);
              /* アスペクト比を維持して中央描画 */
              var scale = Math.min(Reader.WIDTH / img.width, Reader.HEIGHT / img.height);
              var dw = img.width * scale;
              var dh = img.height * scale;
              var dx = (Reader.WIDTH - dw) / 2;
              var dy = (Reader.HEIGHT - dh) / 2;
              ctx.drawImage(img, dx, dy, dw, dh);
              analyzeBmpData(canvas);
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    /* Camera Input ボタン (元 get_camera 87-106) */
    view.bind(el.get_camera_button, function () {
      setStatus('カメラを起動中...');
      if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, Reader.WIDTH, Reader.HEIGHT);
      }
      Reader.startCamera(video, canvas, function (code) {
        /* 検出時 */
        el.card_in.value = code;
        setStatus('バーコード認識: ' + code);
        view.note('カメラ認識成功: ' + code);
        cardReaderVisibleCheck();
      }, function (err) {
        /* カメラ未接続・失敗時 (元 103: card_in.text = "0") */
        el.card_in.value = '0';
        setStatus('カメラエラー: ' + (err.message || '接続できません'));
        view.note('カメラ取得失敗 (0 を設定): ' + (err.message || err));
        cardReaderVisibleCheck();
      });
    });

    /* auto_input (Immediately) チェックボックス (元 142-160) */
    if (el.auto_input) {
      el.auto_input.checked = !!(view.data && view.data.settings && view.data.settings.auto_input);
      if (typeof el.auto_input.addEventListener === 'function') {
        el.auto_input.addEventListener('change', function () {
          if (view.data && view.data.settings) {
            view.data.settings.auto_input = el.auto_input.checked;
            if (BB2.Store) BB2.Store.saveSettings(view.data);
          }
          view.note('auto_input=' + el.auto_input.checked);
        });
      }
    }

    /* 外部公開用参照 */
    Reader.toggleCardReader = toggleCardReader;
    Reader.analyzeBmpData = analyzeBmpData;
    Reader.cardReaderVisibleCheck = cardReaderVisibleCheck;
  };

})(typeof window !== 'undefined' ? window : global);
