/* cards.js — カードブラウザ・XML 読み込み・裏面バーコード解析(barcode_cards.as 1-146 忠実移植・Phase 7-2)
 *
 * 元実装(src/barcode_cards.as):
 *  - 24-33 barcode_cards_init:
 *      xml/list.xml → list_load_complete(card_list_datagrid.dataProvider = xml.item)
 *      xml/bb2.xml  → name_load_complete(card_name_datagrid.dataProvider = xml.item)
 *      card_list_datagrid ListEvent.CHANGE → barcode_list_load
 *      card_name_datagrid ListEvent.CHANGE → barcode_cards_load
 *  - 49-55 barcode_list_load:
 *      "xml/" + card_list_datagrid.selectedItem.xml を読み込み → name_load_complete
 *  - 59-75 barcode_cards_load:
 *      card_image.load(selectedItem.front_img), front_back = true
 *      card_image CLICK → change_front_back_image
 *      back_img_loader.load(selectedItem.back_img) → COMPLETE: barcode_cards_load_done
 *  - 78-104 barcode_cards_load_done + clip:
 *      back_img から clip(bitmap_data, 0, 178, 330, 50) を切り抜き → analyze_barcode_data
 *  - 107-115 change_front_back_image:
 *      front_back ? back_img(front_back=false) : front_img(front_back=true)
 *  - 117-146 analyze_barcode_data:
 *      EAN_8 / EAN_13 としてデコード試行。失敗時は selectedItem.barcode を card_in.text へ設定、
 *      成功時は 13 桁未満の間先頭に "0" を付与して card_in.text へ設定。
 */
(function (global) {
  'use strict';

  var BB2 = global.BB2 = global.BB2 || {};

  /* EAN-13 / EAN-8 1D デコードテーブル(ZXing UPCEANReader / EAN13Reader / EAN8Reader 準拠) */
  var L_PATTERNS = [
    [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
    [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]
  ];
  var G_PATTERNS = L_PATTERNS.map(function (p) { return [p[3], p[2], p[1], p[0]]; });
  /* EAN-13 先頭桁(0..9)の左6桁 L(0)/G(1) パリティビットマスク */
  var FIRST_DIGIT_PARITY = [
    0x00, /* 0: LLLLLL */
    0x0B, /* 1: LLGLGG (001011) */
    0x0D, /* 2: LLGGLG (001101) */
    0x0E, /* 3: LLGGGL (001110) */
    0x13, /* 4: LGLLGG (010011) */
    0x19, /* 5: LGGLLG (011001) */
    0x1C, /* 6: LGGGLL (011100) */
    0x15, /* 7: LGLGLG (010101) */
    0x16, /* 8: LGLGGL (010110) */
    0x1A  /* 9: LGGLGL (011010) */
  ];

  function extractTag(block, tag) {
    var re = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i');
    var m = re.exec(block);
    return m ? m[1].trim() : '';
  }

  /* list.xml のパース(DOMParser 優先・Node 環境等は正規表現フォールバック) */
  function parseListXml(xmlText) {
    var items = [];
    if (!xmlText) return items;
    if (typeof DOMParser !== 'undefined') {
      try {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        var nodes = doc.getElementsByTagName('item');
        if (nodes && nodes.length > 0) {
          for (var i = 0; i < nodes.length; i++) {
            var nEl = nodes[i].getElementsByTagName('name')[0];
            var xEl = nodes[i].getElementsByTagName('xml')[0];
            items.push({
              name: nEl ? (nEl.textContent || '').trim() : '',
              xml: xEl ? (xEl.textContent || '').trim() : ''
            });
          }
          return items;
        }
      } catch (e) {}
    }
    var itemRe = /<item>([\s\S]*?)<\/item>/gi, m;
    while ((m = itemRe.exec(xmlText)) !== null) {
      items.push({
        name: extractTag(m[1], 'name'),
        xml: extractTag(m[1], 'xml')
      });
    }
    return items;
  }

  /* 各カード XML(bb2.xml 等)のパース */
  function parseCardsXml(xmlText) {
    var items = [];
    if (!xmlText) return items;
    if (typeof DOMParser !== 'undefined') {
      try {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        var nodes = doc.getElementsByTagName('item');
        if (nodes && nodes.length > 0) {
          for (var i = 0; i < nodes.length; i++) {
            var nEl = nodes[i].getElementsByTagName('name')[0];
            var fEl = nodes[i].getElementsByTagName('front_img')[0];
            var bEl = nodes[i].getElementsByTagName('back_img')[0];
            var cEl = nodes[i].getElementsByTagName('barcode')[0];
            items.push({
              name: nEl ? (nEl.textContent || '').trim() : '',
              front_img: fEl ? (fEl.textContent || '').trim() : '',
              back_img: bEl ? (bEl.textContent || '').trim() : '',
              barcode: cEl ? (cEl.textContent || '').trim() : ''
            });
          }
          return items;
        }
      } catch (e) {}
    }
    var itemRe = /<item>([\s\S]*?)<\/item>/gi, m;
    while ((m = itemRe.exec(xmlText)) !== null) {
      items.push({
        name: extractTag(m[1], 'name'),
        front_img: extractTag(m[1], 'front_img'),
        back_img: extractTag(m[1], 'back_img'),
        barcode: extractTag(m[1], 'barcode')
      });
    }
    return items;
  }

  /* barcode_cards.as 140-142: 13桁未満なら先頭に "0" を付与 */
  function padBarcode13(barcodeStr) {
    var s = String(barcodeStr == null ? '' : barcodeStr).trim();
    if (!s) return '';
    while (s.length < 13) {
      s = '0' + s;
    }
    return s;
  }

  /* EAN チェックデジット検証(EAN-13 / EAN-8 共通: 右端がチェックデジット、右から2桁目以降が重み 3, 1, 3, 1...) */
  function verifyEanChecksum(digitsStr) {
    if (!digitsStr || (digitsStr.length !== 13 && digitsStr.length !== 8)) return false;
    var sum = 0;
    for (var i = 0; i < digitsStr.length; i++) {
      var d = digitsStr.charCodeAt(digitsStr.length - 1 - i) - 48;
      if (d < 0 || d > 9) return false;
      sum += (i % 2 === 1) ? d * 3 : d;
    }
    return (sum % 10) === 0;
  }

  function matchDigitPattern(counters, offset, patterns) {
    var total = counters[offset] + counters[offset + 1] + counters[offset + 2] + counters[offset + 3];
    if (total <= 0) return { digit: -1, score: Infinity };
    var bestDigit = -1, bestScore = Infinity;
    for (var d = 0; d < patterns.length; d++) {
      var pat = patterns[d], err = 0;
      for (var k = 0; k < 4; k++) {
        var scaled = (counters[offset + k] * 7) / total;
        var diff = Math.abs(scaled - pat[k]);
        err += diff;
      }
      if (err < bestScore) {
        bestScore = err;
        bestDigit = d;
      }
    }
    return { digit: bestDigit, score: bestScore };
  }

  function checkGuardBars(runs, offset, count, refWidth) {
    for (var i = 0; i < count; i++) {
      if (Math.abs(runs[offset + i] - refWidth) > refWidth * 0.85) return false;
    }
    return true;
  }

  function tryDecodeRunsAsEan13(runs, startIdx) {
    if (startIdx + 59 > runs.length) return null;
    /* start guard: 3 bars (1,1,1), center guard at +27: 5 bars (1,1,1,1,1), end guard at +56: 3 bars (1,1,1) */
    var sg = (runs[startIdx] + runs[startIdx + 1] + runs[startIdx + 2]) / 3;
    if (sg <= 0) return null;
    if (!checkGuardBars(runs, startIdx, 3, sg)) return null;
    if (!checkGuardBars(runs, startIdx + 27, 5, sg)) return null;
    if (!checkGuardBars(runs, startIdx + 56, 3, sg)) return null;
    var parityBits = 0, leftStr = '', rightStr = '';
    for (var i = 0; i < 6; i++) {
      var off = startIdx + 3 + i * 4;
      var mL = matchDigitPattern(runs, off, L_PATTERNS);
      var mG = matchDigitPattern(runs, off, G_PATTERNS);
      if (Math.min(mL.score, mG.score) > 2.0) return null;
      if (mG.score < mL.score) {
        parityBits = (parityBits << 1) | 1;
        leftStr += String(mG.digit);
      } else {
        parityBits = (parityBits << 1);
        leftStr += String(mL.digit);
      }
    }
    var firstDigit = FIRST_DIGIT_PARITY.indexOf(parityBits);
    if (firstDigit < 0) return null;
    for (var j = 0; j < 6; j++) {
      var roff = startIdx + 32 + j * 4;
      var mR = matchDigitPattern(runs, roff, L_PATTERNS);
      if (mR.score > 2.0) return null;
      rightStr += String(mR.digit);
    }
    var candidate = String(firstDigit) + leftStr + rightStr;
    return verifyEanChecksum(candidate) ? candidate : null;
  }

  function tryDecodeRunsAsEan8(runs, startIdx) {
    if (startIdx + 43 > runs.length) return null;
    var sg = (runs[startIdx] + runs[startIdx + 1] + runs[startIdx + 2]) / 3;
    if (sg <= 0) return null;
    if (!checkGuardBars(runs, startIdx, 3, sg)) return null;
    if (!checkGuardBars(runs, startIdx + 19, 5, sg)) return null;
    if (!checkGuardBars(runs, startIdx + 40, 3, sg)) return null;
    var leftStr = '', rightStr = '';
    for (var i = 0; i < 4; i++) {
      var mL = matchDigitPattern(runs, startIdx + 3 + i * 4, L_PATTERNS);
      if (mL.score > 2.0) return null;
      leftStr += String(mL.digit);
    }
    for (var j = 0; j < 4; j++) {
      var mR = matchDigitPattern(runs, startIdx + 24 + j * 4, L_PATTERNS);
      if (mR.score > 2.0) return null;
      rightStr += String(mR.digit);
    }
    var candidate = leftStr + rightStr;
    return verifyEanChecksum(candidate) ? candidate : null;
  }

  /* ImageData(330×50 等)から 1D スキャンラインで EAN-13 / EAN-8 をデコード(ZXing 相当) */
  function decodeEanFromImageData(imageData) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) return null;
    var w = imageData.width, h = imageData.height, data = imageData.data;
    var rows = [
      Math.floor(h * 0.5),
      Math.floor(h * 0.4),
      Math.floor(h * 0.6),
      Math.floor(h * 0.3),
      Math.floor(h * 0.7)
    ];
    for (var rIdx = 0; rIdx < rows.length; rIdx++) {
      var y = rows[rIdx];
      if (y < 0 || y >= h) continue;
      var lum = new Array(w);
      var minL = 255, maxL = 0;
      for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 4;
        /* BufferedImageLuminanceSource.as: (306 * R + 601 * G + 117 * B) >> 10 */
        var l = (306 * data[p] + 601 * data[p + 1] + 117 * data[p + 2]) >> 10;
        lum[x] = l;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
      }
      if (maxL - minL < 20) continue;
      var thresholds = [
        (minL + maxL) >> 1,
        minL + Math.floor((maxL - minL) * 0.45),
        minL + Math.floor((maxL - minL) * 0.55)
      ];
      for (var tIdx = 0; tIdx < thresholds.length; tIdx++) {
        var th = thresholds[tIdx];
        var runs = [], isBlackRuns = [];
        var curBlack = lum[0] < th, count = 1;
        for (var xi = 1; xi < w; xi++) {
          var b = lum[xi] < th;
          if (b === curBlack) {
            count++;
          } else {
            runs.push(count);
            isBlackRuns.push(curBlack);
            curBlack = b;
            count = 1;
          }
        }
        runs.push(count);
        isBlackRuns.push(curBlack);
        for (var s = 0; s < runs.length; s++) {
          if (!isBlackRuns[s]) continue; /* 開始ガードは黒バーから */
          var e13 = tryDecodeRunsAsEan13(runs, s);
          if (e13) return e13;
          var e8 = tryDecodeRunsAsEan8(runs, s);
          if (e8) return e8;
        }
      }
    }
    return null;
  }

  /* barcode_cards.as 99-104: clip(src, x, y, w, h) 相当 */
  function clipImageToData(img, x, y, w, h) {
    if (typeof document === 'undefined') return null;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, -x, -y);
      return ctx.getImageData(0, 0, w, h);
    } catch (e) {
      return null;
    }
  }

  /* barcode_cards.as 117-146: analyze_barcode_data 相当 */
  function analyzeBarcodeData(imageData, fallbackBarcode, onDone) {
    var finish = function (decoded) {
      if (!decoded) {
        onDone(String(fallbackBarcode == null ? '' : fallbackBarcode));
      } else {
        onDone(padBarcode13(decoded));
      }
    };
    var syncResult = decodeEanFromImageData(imageData);
    if (syncResult) {
      finish(syncResult);
      return;
    }
    if (typeof BarcodeDetector !== 'undefined' && imageData) {
      try {
        var detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
        detector.detect(imageData).then(function (results) {
          if (results && results.length > 0 && results[0].rawValue) {
            finish(results[0].rawValue);
          } else {
            finish(null);
          }
        }).catch(function () {
          finish(null);
        });
        return;
      } catch (e) {}
    }
    finish(null);
  }

  /* file:// 直開き環境でも動作する内蔵フォールバック辞書(fetch 成功時は assets/xml/*.xml を優先) */
  var FALLBACK_XML = {
    "xml/bb2.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>ラーメン活武</name><front_img>barcode/bb2/83f.jpg</front_img><back_img>barcode/bb2/83b.jpg</back_img><barcode>0401207336501</barcode></item><item><name>ウーロンリー</name><front_img>barcode/bb2/84f.jpg</front_img><back_img>barcode/bb2/84b.jpg</back_img><barcode>0381108136502</barcode></item><item><name>マックスフライ</name><front_img>barcode/bb2/85f.jpg</front_img><back_img>barcode/bb2/85b.jpg</back_img><barcode>0391110346509</barcode></item><item><name>バーモンドクリフ</name><front_img>barcode/bb2/86f.jpg</front_img><back_img>barcode/bb2/86b.jpg</back_img><barcode>0340912373503</barcode></item><item><name>プリンセスグミー</name><front_img>barcode/bb2/87f.jpg</front_img><back_img>barcode/bb2/87b.jpg</back_img><barcode>0320813183500</barcode></item><item><name>中華妖舞</name><front_img>barcode/bb2/88f.jpg</front_img><back_img>barcode/bb2/88b.jpg</back_img><barcode>0331010383501</barcode></item><item><name>デスキン鳥―Ｒ</name><front_img>barcode/bb2/91f.jpg</front_img><back_img>barcode/bb2/91b.jpg</back_img><barcode>3999105145846</barcode></item><item><name>ブラック華麗</name><front_img>barcode/bb2/92f.jpg</front_img><back_img>barcode/bb2/92b.jpg</back_img><barcode>3899496375719</barcode></item><item><name>デスキャメル</name><front_img>barcode/bb2/93f.jpg</front_img><back_img>barcode/bb2/93b.jpg</back_img><barcode>2997971385282</barcode></item><item><name>サイコジゼ</name><front_img>barcode/bb2/94f.jpg</front_img><back_img>barcode/bb2/94b.jpg</back_img><barcode>3598791485238</barcode></item><item><name>ブルーデッド</name><front_img>barcode/bb2/95f.jpg</front_img><back_img>barcode/bb2/95b.jpg</back_img><barcode>3698994455851</barcode></item><item><name>マカロニグラダン</name><front_img>barcode/bb2/96f.jpg</front_img><back_img>barcode/bb2/96b.jpg</back_img><barcode>3198879325700</barcode></item><item><name>血妖狐ドルテ</name><front_img>barcode/bb2/97f.jpg</front_img><back_img>barcode/bb2/97b.jpg</back_img><barcode>3398587475661</barcode></item><item><name>ラーメン堕悪大帝</name><front_img>barcode/bb2/98f.jpg</front_img><back_img>barcode/bb2/98b.jpg</back_img><barcode>4090699045778</barcode></item><item><name>リサイクル博士</name><front_img>barcode/bb2/99f.jpg</front_img><back_img>barcode/bb2/99b.jpg</back_img><barcode>4292519295862</barcode></item><item><name>デスチューハイカーン</name><front_img>barcode/bb2/100f.jpg</front_img><back_img>barcode/bb2/100b.jpg</back_img><barcode>5091594055724</barcode></item><item><name>手裏剣</name><front_img>barcode/bb2/101f.jpg</front_img><back_img>barcode/bb2/101b.jpg</back_img><barcode>0000400603238</barcode></item><item><name>パルティザンソード</name><front_img>barcode/bb2/102f.jpg</front_img><back_img>barcode/bb2/102b.jpg</back_img><barcode>0000500602155</barcode></item><item><name>サイバーロケット砲</name><front_img>barcode/bb2/103f.jpg</front_img><back_img>barcode/bb2/103b.jpg</back_img><barcode>0001200500376</barcode></item><item><name>ハイパーグラス</name><front_img>barcode/bb2/104f.jpg</front_img><back_img>barcode/bb2/104b.jpg</back_img><barcode>0000018703382</barcode></item><item><name>鎖のよろい</name><front_img>barcode/bb2/105f.jpg</front_img><back_img>barcode/bb2/105b.jpg</back_img><barcode>0000007801105</barcode></item><item><name>聖米ヒトメボーレ</name><front_img>barcode/bb2/106f.jpg</front_img><back_img>barcode/bb2/106b.jpg</back_img><barcode>0160000902138</barcode></item><item><name>朝鮮にんじん</name><front_img>barcode/bb2/107f.jpg</front_img><back_img>barcode/bb2/107b.jpg</back_img><barcode>0000500970087</barcode></item><item><name>魔法のランプ</name><front_img>barcode/bb2/108f.jpg</front_img><back_img>barcode/bb2/108b.jpg</back_img><barcode>0000005990054</barcode></item><item><name>情報師ガデン</name><front_img>barcode/bb2/109f.jpg</front_img><back_img>barcode/bb2/109b.jpg</back_img><barcode>0000000950008</barcode></item><item><name>知恵蔵</name><front_img>barcode/bb2/110f.jpg</front_img><back_img>barcode/bb2/110b.jpg</back_img><barcode>0000000960007</barcode></item></root>",
    "xml/bb2b.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>ナイトソープ</name><front_img>barcode/bb2b/1f.jpg</front_img><back_img>barcode/bb2b/1b.jpg</back_img><barcode></barcode></item><item><name>ナイトウインナー</name><front_img>barcode/bb2b/2f.jpg</front_img><back_img>barcode/bb2b/2b.jpg</back_img><barcode></barcode></item><item><name>華麗クック</name><front_img>barcode/bb2b/3f.jpg</front_img><back_img>barcode/bb2b/3b.jpg</back_img><barcode></barcode></item><item><name>マッチＢＯＸ</name><front_img>barcode/bb2b/4f.jpg</front_img><back_img>barcode/bb2b/4b.jpg</back_img><barcode></barcode></item><item><name>ファイブＭＧ</name><front_img>barcode/bb2b/5f.jpg</front_img><back_img>barcode/bb2b/5b.jpg</back_img><barcode></barcode></item><item><name>グリーンチャーミング</name><front_img>barcode/bb2b/6f.jpg</front_img><back_img>barcode/bb2b/6b.jpg</back_img><barcode></barcode></item><item><name>焼酎力</name><front_img>barcode/bb2b/7f.jpg</front_img><back_img>barcode/bb2b/7b.jpg</back_img><barcode></barcode></item><item><name>エンゼルハイ</name><front_img>barcode/bb2b/8f.jpg</front_img><back_img>barcode/bb2b/8b.jpg</back_img><barcode></barcode></item><item><name>牙鋲魔久</name><front_img>barcode/bb2b/9f.jpg</front_img><back_img>barcode/bb2b/9b.jpg</back_img><barcode></barcode></item><item><name>ナンチューカ</name><front_img>barcode/bb2b/10f.jpg</front_img><back_img>barcode/bb2b/10b.jpg</back_img><barcode></barcode></item><item><name>ネッスル大帝</name><front_img>barcode/bb2b/11f.jpg</front_img><back_img>barcode/bb2b/11b.jpg</back_img><barcode></barcode></item><item><name>セロハーン</name><front_img>barcode/bb2b/12f.jpg</front_img><back_img>barcode/bb2b/12b.jpg</back_img><barcode></barcode></item><item><name>アウトサイダー</name><front_img>barcode/bb2b/13f.jpg</front_img><back_img>barcode/bb2b/13b.jpg</back_img><barcode></barcode></item><item><name>ナンチューカ</name><front_img>barcode/bb2b/10f.jpg</front_img><back_img>barcode/bb2b/10b.jpg</back_img><barcode></barcode></item><item><name>ドドン兵衛</name><front_img>barcode/bb2b/14f.jpg</front_img><back_img>barcode/bb2b/14b.jpg</back_img><barcode></barcode></item><item><name>火取鋭光</name><front_img>barcode/bb2b/15f.jpg</front_img><back_img>barcode/bb2b/15b.jpg</back_img><barcode></barcode></item><item><name>鬼桜王</name><front_img>barcode/bb2b/16f.jpg</front_img><back_img>barcode/bb2b/16b.jpg</back_img><barcode></barcode></item><item><name>ノリタ魔</name><front_img>barcode/bb2b/17f.jpg</front_img><back_img>barcode/bb2b/17b.jpg</back_img><barcode></barcode></item><item><name>ホチキッス</name><front_img>barcode/bb2b/18f.jpg</front_img><back_img>barcode/bb2b/18b.jpg</back_img><barcode>1544035073169</barcode></item><item><name>帝王ゴッドカーメン</name><front_img>barcode/bb2b/19f.jpg</front_img><back_img>barcode/bb2b/19b.jpg</back_img><barcode></barcode></item><item><name>エメローン</name><front_img>barcode/bb2b/20f.jpg</front_img><back_img>barcode/bb2b/20b.jpg</back_img><barcode></barcode></item><item><name>ボンドナイト</name><front_img>barcode/bb2b/21f.jpg</front_img><back_img>barcode/bb2b/21b.jpg</back_img><barcode></barcode></item><item><name>ヤングボン華麗</name><front_img>barcode/bb2b/22f.jpg</front_img><back_img>barcode/bb2b/22b.jpg</back_img><barcode></barcode></item><item><name>エビセンマン</name><front_img>barcode/bb2b/23f.jpg</front_img><back_img>barcode/bb2b/23b.jpg</back_img><barcode></barcode></item><item><name>キューティーザーネ</name><front_img>barcode/bb2b/24f.jpg</front_img><back_img>barcode/bb2b/24b.jpg</back_img><barcode></barcode></item><item><name>チキンラーマン</name><front_img>barcode/bb2b/25f.jpg</front_img><back_img>barcode/bb2b/25b.jpg</back_img><barcode></barcode></item><item><name>小梅チーン</name><front_img>barcode/bb2b/26f.jpg</front_img><back_img>barcode/bb2b/26b.jpg</back_img><barcode></barcode></item><item><name>面魔王</name><front_img>barcode/bb2b/27f.jpg</front_img><back_img>barcode/bb2b/27b.jpg</back_img><barcode></barcode></item><item><name>ヤングウーロンチャン</name><front_img>barcode/bb2b/28f.jpg</front_img><back_img>barcode/bb2b/28b.jpg</back_img><barcode></barcode></item><item><name>ハンガーチャン</name><front_img>barcode/bb2b/29f.jpg</front_img><back_img>barcode/bb2b/29b.jpg</back_img><barcode></barcode></item><item><name>コーン・スープル</name><front_img>barcode/bb2b/30f.jpg</front_img><back_img>barcode/bb2b/30b.jpg</back_img><barcode></barcode></item><item><name>ハイ・Ｃサー</name><front_img>barcode/bb2b/31f.jpg</front_img><back_img>barcode/bb2b/31b.jpg</back_img><barcode></barcode></item><item><name>デンタック</name><front_img>barcode/bb2b/32f.jpg</front_img><back_img>barcode/bb2b/32b.jpg</back_img><barcode></barcode></item><item><name>硝火鬼</name><front_img>barcode/bb2b/33f.jpg</front_img><back_img>barcode/bb2b/33b.jpg</back_img><barcode></barcode></item><item><name>神魔変化</name><front_img>barcode/bb2b/34f.jpg</front_img><back_img>barcode/bb2b/34b.jpg</back_img><barcode></barcode></item><item><name>源海</name><front_img>barcode/bb2b/35f.jpg</front_img><back_img>barcode/bb2b/35b.jpg</back_img><barcode>3296752405409</barcode></item><item><name>チューハイカーンJr.</name><front_img>barcode/bb2b/36f.jpg</front_img><back_img>barcode/bb2b/36b.jpg</back_img><barcode>2194845415490</barcode></item><item><name>ヤング阻破</name><front_img>barcode/bb2b/37f.jpg</front_img><back_img>barcode/bb2b/37b.jpg</back_img><barcode>1994542424495</barcode></item><item><name>帝王ゴッドサンダー</name><front_img>barcode/bb2b/38f.jpg</front_img><back_img>barcode/bb2b/38b.jpg</back_img><barcode></barcode></item><item><name>バドーワイザー</name><front_img>barcode/bb2b/39f.jpg</front_img><back_img>barcode/bb2b/39b.jpg</back_img><barcode></barcode></item><item><name>聖シャルダン</name><front_img>barcode/bb2b/40f.jpg</front_img><back_img>barcode/bb2b/40b.jpg</back_img><barcode></barcode></item><item><name>バーモントクリフ</name><front_img>barcode/bb2b/41f.jpg</front_img><back_img>barcode/bb2b/41b.jpg</back_img><barcode></barcode></item><item><name>カロピスウォーター</name><front_img>barcode/bb2b/42f.jpg</front_img><back_img>barcode/bb2b/42b.jpg</back_img><barcode></barcode></item><item><name>オリゴンＣ２</name><front_img>barcode/bb2b/43f.jpg</front_img><back_img>barcode/bb2b/43b.jpg</back_img><barcode></barcode></item><item><name>スキ邪鬼1000K</name><front_img>barcode/bb2b/44f.jpg</front_img><back_img>barcode/bb2b/44b.jpg</back_img><barcode></barcode></item><item><name>ＫＲブライトン</name><front_img>barcode/bb2b/45f.jpg</front_img><back_img>barcode/bb2b/45b.jpg</back_img><barcode></barcode></item><item><name>キットカーン</name><front_img>barcode/bb2b/46f.jpg</front_img><back_img>barcode/bb2b/46b.jpg</back_img><barcode></barcode></item><item><name>魔ジック</name><front_img>barcode/bb2b/47f.jpg</front_img><back_img>barcode/bb2b/47b.jpg</back_img><barcode></barcode></item><item><name>樹氷魔</name><front_img>barcode/bb2b/48f.jpg</front_img><back_img>barcode/bb2b/48b.jpg</back_img><barcode></barcode></item><item><name>写ランデス</name><front_img>barcode/bb2b/49f.jpg</front_img><back_img>barcode/bb2b/49b.jpg</back_img><barcode></barcode></item><item><name>ハーゲンダッツ将軍</name><front_img>barcode/bb2b/50f.jpg</front_img><back_img>barcode/bb2b/50b.jpg</back_img><barcode>2696043305493</barcode></item><item><name>ユンケル皇帝</name><front_img>barcode/bb2b/51f.jpg</front_img><back_img>barcode/bb2b/51b.jpg</back_img><barcode></barcode></item><item><name>燐風</name><front_img>barcode/bb2b/52f.jpg</front_img><back_img>barcode/bb2b/52b.jpg</back_img><barcode></barcode></item><item><name>面僧留</name><front_img>barcode/bb2b/53f.jpg</front_img><back_img>barcode/bb2b/53b.jpg</back_img><barcode></barcode></item><item><name>美出王</name><front_img>barcode/bb2b/54f.jpg</front_img><back_img>barcode/bb2b/54b.jpg</back_img><barcode></barcode></item><item><name>ハードムース</name><front_img>barcode/bb2b/53f.jpg</front_img><back_img>barcode/bb2b/53b.jpg</back_img><barcode></barcode></item><item><name>ハイケネン大佐</name><front_img>barcode/bb2b/54f.jpg</front_img><back_img>barcode/bb2b/54b.jpg</back_img><barcode></barcode></item><item><name>帝王ゴッドヒットラー</name><front_img>barcode/bb2b/57f.jpg</front_img><back_img>barcode/bb2b/57b.jpg</back_img><barcode></barcode></item><item><name>レトルトナイト</name><front_img>barcode/bb2b/58f.jpg</front_img><back_img>barcode/bb2b/58b.jpg</back_img><barcode></barcode></item><item><name>カロピスウォーター1000</name><front_img>barcode/bb2b/59f.jpg</front_img><back_img>barcode/bb2b/59b.jpg</back_img><barcode></barcode></item><item><name>麻シャンヌ</name><front_img>barcode/bb2b/60f.jpg</front_img><back_img>barcode/bb2b/60b.jpg</back_img><barcode></barcode></item><item><name>ティポン・カードロコ</name><front_img>barcode/bb2b/61f.jpg</front_img><back_img>barcode/bb2b/61b.jpg</back_img><barcode></barcode></item><item><name>ダダーンＰ</name><front_img>barcode/bb2b/62f.jpg</front_img><back_img>barcode/bb2b/62b.jpg</back_img><barcode></barcode></item><item><name>ＭＡＤ・ラーク</name><front_img>barcode/bb2b/63f.jpg</front_img><back_img>barcode/bb2b/63b.jpg</back_img><barcode></barcode></item><item><name>コマンドＬＰ</name><front_img>barcode/bb2b/64f.jpg</front_img><back_img>barcode/bb2b/64b.jpg</back_img><barcode></barcode></item><item><name>ルウ・サンポー</name><front_img>barcode/bb2b/65f.jpg</front_img><back_img>barcode/bb2b/65b.jpg</back_img><barcode></barcode></item><item><name>華麗妖美</name><front_img>barcode/bb2b/66f.jpg</front_img><back_img>barcode/bb2b/66b.jpg</back_img><barcode></barcode></item><item><name>ムーニー・リー</name><front_img>barcode/bb2b/67f.jpg</front_img><back_img>barcode/bb2b/67b.jpg</back_img><barcode></barcode></item><item><name>鋼帝ミロ</name><front_img>barcode/bb2b/68f.jpg</front_img><back_img>barcode/bb2b/68b.jpg</back_img><barcode></barcode></item><item><name>プレアヌス一世</name><front_img>barcode/bb2b/69f.jpg</front_img><back_img>barcode/bb2b/69b.jpg</back_img><barcode></barcode></item><item><name>ティモテ姫</name><front_img>barcode/bb2b/70f.jpg</front_img><back_img>barcode/bb2b/70b.jpg</back_img><barcode></barcode></item><item><name>勘太郎</name><front_img>barcode/bb2b/71f.jpg</front_img><back_img>barcode/bb2b/71b.jpg</back_img><barcode></barcode></item><item><name>雪見大五郎</name><front_img>barcode/bb2b/72f.jpg</front_img><back_img>barcode/bb2b/72b.jpg</back_img><barcode></barcode></item><item><name>ウーロン将軍</name><front_img>barcode/bb2b/73f.jpg</front_img><back_img>barcode/bb2b/73b.jpg</back_img><barcode></barcode></item><item><name>アクローン</name><front_img>barcode/bb2b/74f.jpg</front_img><back_img>barcode/bb2b/74b.jpg</back_img><barcode></barcode></item><item><name>ジャワＴＳ</name><front_img>barcode/bb2b/75f.jpg</front_img><back_img>barcode/bb2b/75b.jpg</back_img><barcode></barcode></item><item><name>帝王ゴッドＲＸ－ＣＴ</name><front_img>barcode/bb2b/76f.jpg</front_img><back_img>barcode/bb2b/76b.jpg</back_img><barcode></barcode></item><item><name>ショートソード</name><front_img>barcode/bb2b/77f.jpg</front_img><back_img>barcode/bb2b/77b.jpg</back_img><barcode></barcode></item><item><name>砲丸スパイク</name><front_img>barcode/bb2b/78f.jpg</front_img><back_img>barcode/bb2b/78b.jpg</back_img><barcode></barcode></item><item><name>鉄のよろい</name><front_img>barcode/bb2b/79f.jpg</front_img><back_img>barcode/bb2b/79b.jpg</back_img><barcode></barcode></item><item><name>ドラゴンシールド</name><front_img>barcode/bb2b/80f.jpg</front_img><back_img>barcode/bb2b/80b.jpg</back_img><barcode></barcode></item><item><name>強心剤</name><front_img>barcode/bb2b/81f.jpg</front_img><back_img>barcode/bb2b/81b.jpg</back_img><barcode></barcode></item><item><name>パワーＷドリンク</name><front_img>barcode/bb2b/82f.jpg</front_img><back_img>barcode/bb2b/82b.jpg</back_img><barcode></barcode></item><item><name>魔法のペンダント</name><front_img>barcode/bb2b/83f.jpg</front_img><back_img>barcode/bb2b/83b.jpg</back_img><barcode></barcode></item><item><name>魔法のステッキ</name><front_img>barcode/bb2b/84f.jpg</front_img><back_img>barcode/bb2b/84b.jpg</back_img><barcode></barcode></item><item><name>命の水</name><front_img>barcode/bb2b/85f.jpg</front_img><back_img>barcode/bb2b/85b.jpg</back_img><barcode></barcode></item><item><name>ワープカプセル</name><front_img>barcode/bb2b/86f.jpg</front_img><back_img>barcode/bb2b/86b.jpg</back_img><barcode></barcode></item><item><name>極秘カセットテープ</name><front_img>barcode/bb2b/87f.jpg</front_img><back_img>barcode/bb2b/87b.jpg</back_img><barcode></barcode></item><item><name>甲賀の巻物</name><front_img>barcode/bb2b/88f.jpg</front_img><back_img>barcode/bb2b/88b.jpg</back_img><barcode></barcode></item><item><name>ウーロンリー</name><front_img>barcode/bb2b/89f.jpg</front_img><back_img>barcode/bb2b/89b.jpg</back_img><barcode></barcode></item><item><name>バーモンドクリフ</name><front_img>barcode/bb2b/90f.jpg</front_img><back_img>barcode/bb2b/90b.jpg</back_img><barcode></barcode></item><item><name>チャーシューファン</name><front_img>barcode/bb2b/91f.jpg</front_img><back_img>barcode/bb2b/91b.jpg</back_img><barcode></barcode></item><item><name>デンターラ</name><front_img>barcode/bb2b/92f.jpg</front_img><back_img>barcode/bb2b/92b.jpg</back_img><barcode></barcode></item></root>",
    "xml/bf2.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>ビートルアトラス</name><front_img>barcode/bf2/1f.jpg</front_img><back_img>barcode/bf2/1b.jpg</back_img><barcode></barcode></item><item><name>ＵＳＡザ・グレート</name><front_img>barcode/bf2/2f.jpg</front_img><back_img>barcode/bf2/2b.jpg</back_img><barcode></barcode></item><item><name>シルフィード・セラフ</name><front_img>barcode/bf2/3f.jpg</front_img><back_img>barcode/bf2/3b.jpg</back_img><barcode></barcode></item><item><name>スーパーＫＴ－1</name><front_img>barcode/bf2/4f.jpg</front_img><back_img>barcode/bf2/4b.jpg</back_img><barcode></barcode></item><item><name>メカ－トロペオス</name><front_img>barcode/bf2/5f.jpg</front_img><back_img>barcode/bf2/5b.jpg</back_img><barcode></barcode></item><item><name>メカ－ズンガリス</name><front_img>barcode/bf2/6f.jpg</front_img><back_img>barcode/bf2/6b.jpg</back_img><barcode></barcode></item><item><name>メカ－ランフォリス</name><front_img>barcode/bf2/7f.jpg</front_img><back_img>barcode/bf2/7b.jpg</back_img><barcode></barcode></item><item><name>メカ－ディモルフス</name><front_img>barcode/bf2/8f.jpg</front_img><back_img>barcode/bf2/8b.jpg</back_img><barcode></barcode></item><item><name>メカ－プテラノス</name><front_img>barcode/bf2/9f.jpg</front_img><back_img>barcode/bf2/9b.jpg</back_img><barcode></barcode></item><item><name>メカ－ケツァルス</name><front_img>barcode/bf2/10f.jpg</front_img><back_img>barcode/bf2/10b.jpg</back_img><barcode></barcode></item><item><name>メカ－アルケロス</name><front_img>barcode/bf2/11f.jpg</front_img><back_img>barcode/bf2/11b.jpg</back_img><barcode></barcode></item><item><name>メカ－ティロス</name><front_img>barcode/bf2/12f.jpg</front_img><back_img>barcode/bf2/12b.jpg</back_img><barcode></barcode></item><item><name>メカ－ショーニス</name><front_img>barcode/bf2/13f.jpg</front_img><back_img>barcode/bf2/13b.jpg</back_img><barcode></barcode></item><item><name>メカ－クロノス</name><front_img>barcode/bf2/14f.jpg</front_img><back_img>barcode/bf2/14b.jpg</back_img><barcode></barcode></item><item><name>メカ－エラスモス</name><front_img>barcode/bf2/15f.jpg</front_img><back_img>barcode/bf2/15b.jpg</back_img><barcode></barcode></item><item><name>メカ－プレシオス</name><front_img>barcode/bf2/16f.jpg</front_img><back_img>barcode/bf2/16b.jpg</back_img><barcode>3896588455779</barcode></item><item><name>メカ－ガリミムス</name><front_img>barcode/bf2/17f.jpg</front_img><back_img>barcode/bf2/17b.jpg</back_img><barcode></barcode></item><item><name>メカ－ユーオプロス</name><front_img>barcode/bf2/18f.jpg</front_img><back_img>barcode/bf2/18b.jpg</back_img><barcode></barcode></item><item><name>メカ－スティラコス</name><front_img>barcode/bf2/19f.jpg</front_img><back_img>barcode/bf2/19b.jpg</back_img><barcode></barcode></item><item><name>メカ－ランベオス</name><front_img>barcode/bf2/20f.jpg</front_img><back_img>barcode/bf2/20b.jpg</back_img><barcode></barcode></item><item><name>メカ－ブラキオス</name><front_img>barcode/bf2/21f.jpg</front_img><back_img>barcode/bf2/21b.jpg</back_img><barcode></barcode></item><item><name>メカ－アロス</name><front_img>barcode/bf2/22f.jpg</front_img><back_img>barcode/bf2/22b.jpg</back_img><barcode></barcode></item><item><name>メカ－ティラノス</name><front_img>barcode/bf2/23f.jpg</front_img><back_img>barcode/bf2/23b.jpg</back_img><barcode></barcode></item><item><name>メカ－ディノケイルス</name><front_img>barcode/bf2/24f.jpg</front_img><back_img>barcode/bf2/24b.jpg</back_img><barcode></barcode></item><item><name>ディライトフォシール</name><front_img>barcode/bf2/25f.jpg</front_img><back_img>barcode/bf2/25b.jpg</back_img><barcode></barcode></item><item><name>ダイノソード</name><front_img>barcode/bf2/26f.jpg</front_img><back_img>barcode/bf2/26b.jpg</back_img><barcode></barcode></item><item><name>カイセニシールド</name><front_img>barcode/bf2/27f.jpg</front_img><back_img>barcode/bf2/27b.jpg</back_img><barcode></barcode></item><item><name>インゲンスロッド</name><front_img>barcode/bf2/28f.jpg</front_img><back_img>barcode/bf2/28b.jpg</back_img><barcode></barcode></item><item><name>パキケファロポッド</name><front_img>barcode/bf2/29f.jpg</front_img><back_img>barcode/bf2/29b.jpg</back_img><barcode></barcode></item><item><name>なつきとゆーこ</name><front_img>barcode/bf2/30f.jpg</front_img><back_img>barcode/bf2/30b.jpg</back_img><barcode></barcode></item></root>",
    "xml/bfc.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>虎堂 烈</name><front_img>barcode/bfc/1f.jpg</front_img><back_img>barcode/bfc/1b.jpg</back_img><barcode>0492116128172</barcode></item><item><name>ダッシュビートルII</name><front_img>barcode/bfc/2f.jpg</front_img><back_img>barcode/bfc/2b.jpg</back_img><barcode>1734959324182</barcode></item><item><name>スティーブ・セコイア</name><front_img>barcode/bfc/3f.jpg</front_img><back_img>barcode/bfc/3b.jpg</back_img><barcode>0471621124008</barcode></item><item><name>キャプテン・ＵＳＡ</name><front_img>barcode/bfc/4f.jpg</front_img><back_img>barcode/bfc/4b.jpg</back_img><barcode>1965848028007</barcode></item><item><name>有栖川 桜</name><front_img>barcode/bfc/5f.jpg</front_img><back_img>barcode/bfc/5b.jpg</back_img><barcode>0321017070016</barcode></item><item><name>ラ・シルフィード</name><front_img>barcode/bfc/6f.jpg</front_img><back_img>barcode/bfc/6b.jpg</back_img><barcode>1503125370250</barcode></item><item><name>掛須　巧</name><front_img>barcode/bfc/7f.jpg</front_img><back_img>barcode/bfc/7b.jpg</back_img><barcode>0481524118004</barcode></item><item><name>ＫＴ－１</name><front_img>barcode/bfc/8f.jpg</front_img><back_img>barcode/bfc/8b.jpg</back_img><barcode>1815360026169</barcode></item><item><name>ダッシュビートル（後期型）</name><front_img>barcode/bfc/9f.jpg</front_img><back_img>barcode/bfc/9b.jpg</back_img><barcode>2896068315006</barcode></item><item><name>ショルダー・シールド</name><front_img>barcode/bfc/10f.jpg</front_img><back_img>barcode/bfc/10b.jpg</back_img><barcode>0000003811214</barcode></item><item><name>キャプテンＵ・Ｓ・Ａ</name><front_img>barcode/bfc/11f.jpg</front_img><back_img>barcode/bfc/11b.jpg</back_img><barcode>2996964425004</barcode></item><item><name>マンハッタン・バスター</name><front_img>barcode/bfc/12f.jpg</front_img><back_img>barcode/bfc/12b.jpg</back_img><barcode>0001500623386</barcode></item><item><name>ハッターマン</name><front_img>barcode/bfc/13f.jpg</front_img><back_img>barcode/bfc/13b.jpg</back_img><barcode>2594644415002</barcode></item><item><name>ハッターマン</name><front_img>barcode/bfc/14f.jpg</front_img><back_img>barcode/bfc/14b.jpg</back_img><barcode>2095451375003</barcode></item><item><name>アルフォンソ博士</name><front_img>barcode/bfc/15f.jpg</front_img><back_img>barcode/bfc/15b.jpg</back_img><barcode>2494748425009</barcode></item><item><name>アルフォンソ博士</name><front_img>barcode/bfc/16f.jpg</front_img><back_img>barcode/bfc/16b.jpg</back_img><barcode>2195556475001</barcode></item><item><name>スタッグ・ビートル</name><front_img>barcode/bfc/17f.jpg</front_img><back_img>barcode/bfc/17b.jpg</back_img><barcode>3698188385377</barcode></item></root>",
    "xml/bungu.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>鉛筆</name><front_img>barcode/bungu/enpitsu.jpg</front_img><back_img>barcode/bungu/enpitsu.jpg</back_img><barcode></barcode></item><item><name>バトル消しゴム</name><front_img>barcode/bungu/eraser.jpg</front_img><back_img>barcode/bungu/eraser.jpg</back_img><barcode></barcode></item><item><name>カードファイル(1)</name><front_img>barcode/bungu/file.jpg</front_img><back_img>barcode/bungu/file.jpg</back_img><barcode></barcode></item><item><name>カードファイル(2)</name><front_img>barcode/bungu/file2.jpg</front_img><back_img>barcode/bungu/file2.jpg</back_img><barcode></barcode></item><item><name>カードメモ</name><front_img>barcode/bungu/memo.jpg</front_img><back_img>barcode/bungu/memo.jpg</back_img><barcode>1622847045441</barcode></item><item><name>戦士ノート</name><front_img>barcode/bungu/note.jpg</front_img><back_img>barcode/bungu/note.jpg</back_img><barcode></barcode></item><item><name>バトル定規</name><front_img>barcode/bungu/pen.jpg</front_img><back_img>barcode/bungu/pen.jpg</back_img><barcode></barcode></item><item><name>カードBOX</name><front_img>barcode/bungu/pencase.jpg</front_img><back_img>barcode/bungu/pencase.jpg</back_img><barcode></barcode></item><item><name>バトルシャープ</name><front_img>barcode/bungu/sharp.jpg</front_img><back_img>barcode/bungu/sharp.jpg</back_img><barcode></barcode></item><item><name>シール</name><front_img>barcode/bungu/sheel.jpg</front_img><back_img>barcode/bungu/sheel.jpg</back_img><barcode></barcode></item><item><name>下敷き</name><front_img>barcode/bungu/shitajiki.jpg</front_img><back_img>barcode/bungu/shitajiki.jpg</back_img><barcode></barcode></item><item><name>バトラー両面テープ</name><front_img>barcode/bungu/tape.jpg</front_img><back_img>barcode/bungu/tape.jpg</back_img><barcode></barcode></item></root>",
    "xml/bw.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>キャリー</name><front_img>barcode/bw/1f.jpg</front_img><back_img>barcode/bw/1b.jpg</back_img><barcode></barcode></item><item><name>ケイン＝ガードナー</name><front_img>barcode/bw/2f.jpg</front_img><back_img>barcode/bw/2b.jpg</back_img><barcode></barcode></item><item><name>ヘベ</name><front_img>barcode/bw/3f.jpg</front_img><back_img>barcode/bw/3b.jpg</back_img><barcode></barcode></item><item><name>ぢぇにふぁー</name><front_img>barcode/bw/4f.jpg</front_img><back_img>barcode/bw/4b.jpg</back_img><barcode></barcode></item><item><name>ルシア</name><front_img>barcode/bw/5f.jpg</front_img><back_img>barcode/bw/5b.jpg</back_img><barcode></barcode></item><item><name>ゆめたろー＆おはぎ</name><front_img>barcode/bw/6f.jpg</front_img><back_img>barcode/bw/6b.jpg</back_img><barcode></barcode></item><item><name>おーちゃん</name><front_img>barcode/bw/7f.jpg</front_img><back_img>barcode/bw/7b.jpg</back_img><barcode></barcode></item><item><name>助佐衛門</name><front_img>barcode/bw/8f.jpg</front_img><back_img>barcode/bw/8b.jpg</back_img><barcode></barcode></item><item><name>ぽぷーん</name><front_img>barcode/bw/9f.jpg</front_img><back_img>barcode/bw/9b.jpg</back_img><barcode></barcode></item><item><name>機関銃</name><front_img>barcode/bw/10f.jpg</front_img><back_img>barcode/bw/10b.jpg</back_img><barcode></barcode></item><item><name>ニトロガン</name><front_img>barcode/bw/11f.jpg</front_img><back_img>barcode/bw/11b.jpg</back_img><barcode></barcode></item><item><name>バリアロッド</name><front_img>barcode/bw/12f.jpg</front_img><back_img>barcode/bw/12b.jpg</back_img><barcode></barcode></item><item><name>ビニールの刀</name><front_img>barcode/bw/13f.jpg</front_img><back_img>barcode/bw/13b.jpg</back_img><barcode></barcode></item><item><name>ヘベのぼうし</name><front_img>barcode/bw/14f.jpg</front_img><back_img>barcode/bw/14b.jpg</back_img><barcode></barcode></item><item><name>ネコの着ぐるみ</name><front_img>barcode/bw/15f.jpg</front_img><back_img>barcode/bw/15b.jpg</back_img><barcode></barcode></item><item><name>パワードアーマー</name><front_img>barcode/bw/16f.jpg</front_img><back_img>barcode/bw/16b.jpg</back_img><barcode></barcode></item><item><name>ハヤブサスーツ</name><front_img>barcode/bw/17f.jpg</front_img><back_img>barcode/bw/17b.jpg</back_img><barcode></barcode></item><item><name>マジックブーツ</name><front_img>barcode/bw/18f.jpg</front_img><back_img>barcode/bw/18b.jpg</back_img><barcode></barcode></item><item><name>インズマス</name><front_img>barcode/bw/19f.jpg</front_img><back_img>barcode/bw/19b.jpg</back_img><barcode></barcode></item><item><name>粘着剤</name><front_img>barcode/bw/20f.jpg</front_img><back_img>barcode/bw/20b.jpg</back_img><barcode></barcode></item><item><name>ロシアンフーセン</name><front_img>barcode/bw/21f.jpg</front_img><back_img>barcode/bw/21b.jpg</back_img><barcode></barcode></item><item><name>キャンディ</name><front_img>barcode/bw/22f.jpg</front_img><back_img>barcode/bw/22b.jpg</back_img><barcode></barcode></item><item><name>スケートボード</name><front_img>barcode/bw/23f.jpg</front_img><back_img>barcode/bw/23b.jpg</back_img><barcode></barcode></item><item><name>プラモデル</name><front_img>barcode/bw/24f.jpg</front_img><back_img>barcode/bw/24b.jpg</back_img><barcode></barcode></item></root>",
    "xml/dr.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>ドラえもん</name><front_img>barcode/dr/1f.jpg</front_img><back_img>barcode/dr/1b.jpg</back_img><barcode></barcode></item><item><name>ドラえもん</name><front_img>barcode/dr/2f.jpg</front_img><back_img>barcode/dr/2b.jpg</back_img><barcode></barcode></item><item><name>のび太</name><front_img>barcode/dr/3f.jpg</front_img><back_img>barcode/dr/3b.jpg</back_img><barcode></barcode></item><item><name>のび太</name><front_img>barcode/dr/4f.jpg</front_img><back_img>barcode/dr/4b.jpg</back_img><barcode></barcode></item><item><name>ジャイアン</name><front_img>barcode/dr/5f.jpg</front_img><back_img>barcode/dr/5b.jpg</back_img><barcode></barcode></item><item><name>ジャイアン</name><front_img>barcode/dr/6f.jpg</front_img><back_img>barcode/dr/6b.jpg</back_img><barcode></barcode></item><item><name>スネ夫</name><front_img>barcode/dr/7f.jpg</front_img><back_img>barcode/dr/7b.jpg</back_img><barcode></barcode></item><item><name>スネ夫</name><front_img>barcode/dr/8f.jpg</front_img><back_img>barcode/dr/8b.jpg</back_img><barcode></barcode></item><item><name>しずかちゃん</name><front_img>barcode/dr/9f.jpg</front_img><back_img>barcode/dr/9b.jpg</back_img><barcode></barcode></item><item><name>しずかちゃん</name><front_img>barcode/dr/10f.jpg</front_img><back_img>barcode/dr/10b.jpg</back_img><barcode></barcode></item><item><name>のび太のおかあさん</name><front_img>barcode/dr/11f.jpg</front_img><back_img>barcode/dr/11b.jpg</back_img><barcode></barcode></item><item><name>恐竜ハンター</name><front_img>barcode/dr/12f.jpg</front_img><back_img>barcode/dr/12b.jpg</back_img><barcode></barcode></item><item><name>アーケロン</name><front_img>barcode/dr/13f.jpg</front_img><back_img>barcode/dr/13b.jpg</back_img><barcode></barcode></item><item><name>ティラノサウルス</name><front_img>barcode/dr/14f.jpg</front_img><back_img>barcode/dr/14b.jpg</back_img><barcode></barcode></item><item><name>トリコノドン</name><front_img>barcode/dr/15f.jpg</front_img><back_img>barcode/dr/15b.jpg</back_img><barcode></barcode></item><item><name>オーニソミマス</name><front_img>barcode/dr/16f.jpg</front_img><back_img>barcode/dr/16b.jpg</back_img><barcode></barcode></item><item><name>ブロントサウルス</name><front_img>barcode/dr/17f.jpg</front_img><back_img>barcode/dr/17b.jpg</back_img><barcode></barcode></item><item><name>プテラノドン</name><front_img>barcode/dr/18f.jpg</front_img><back_img>barcode/dr/18b.jpg</back_img><barcode></barcode></item><item><name>謎の宇宙船</name><front_img>barcode/dr/19f.jpg</front_img><back_img>barcode/dr/19b.jpg</back_img><barcode></barcode></item><item><name>大富豪ドルマンスタン</name><front_img>barcode/dr/20f.jpg</front_img><back_img>barcode/dr/20b.jpg</back_img><barcode></barcode></item><item><name>タイムふろしき</name><front_img>barcode/dr/21f.jpg</front_img><back_img>barcode/dr/21b.jpg</back_img><barcode></barcode></item><item><name>スモールライト</name><front_img>barcode/dr/22f.jpg</front_img><back_img>barcode/dr/22b.jpg</back_img><barcode></barcode></item><item><name>タイムマシン</name><front_img>barcode/dr/23f.jpg</front_img><back_img>barcode/dr/23b.jpg</back_img><barcode></barcode></item><item><name>深海クリーム</name><front_img>barcode/dr/24f.jpg</front_img><back_img>barcode/dr/24b.jpg</back_img><barcode></barcode></item><item><name>タケコプター</name><front_img>barcode/dr/25f.jpg</front_img><back_img>barcode/dr/25b.jpg</back_img><barcode></barcode></item><item><name>桃太郎印のきびだｓんご</name><front_img>barcode/dr/26f.jpg</front_img><back_img>barcode/dr/26b.jpg</back_img><barcode></barcode></item><item><name>ラジコンねん土</name><front_img>barcode/dr/27f.jpg</front_img><back_img>barcode/dr/27b.jpg</back_img><barcode></barcode></item><item><name>ひらりマント</name><front_img>barcode/dr/28f.jpg</front_img><back_img>barcode/dr/28b.jpg</back_img><barcode></barcode></item><item><name>ペア</name><front_img>barcode/dr/29f.jpg</front_img><back_img>barcode/dr/29b.jpg</back_img><barcode></barcode></item><item><name>ペア</name><front_img>barcode/dr/30f.jpg</front_img><back_img>barcode/dr/30b.jpg</back_img><barcode></barcode></item><item><name>チェンジ</name><front_img>barcode/dr/31f.jpg</front_img><back_img>barcode/dr/31b.jpg</back_img><barcode></barcode></item><item><name>チェンジ</name><front_img>barcode/dr/32f.jpg</front_img><back_img>barcode/dr/32b.jpg</back_img><barcode></barcode></item><item><name>エクスチェンジ</name><front_img>barcode/dr/33f.jpg</front_img><back_img>barcode/dr/33b.jpg</back_img><barcode></barcode></item><item><name>エクスチェンジ</name><front_img>barcode/dr/34f.jpg</front_img><back_img>barcode/dr/34b.jpg</back_img><barcode></barcode></item><item><name>コピー</name><front_img>barcode/dr/35f.jpg</front_img><back_img>barcode/dr/35b.jpg</back_img><barcode></barcode></item><item><name>コピー</name><front_img>barcode/dr/36f.jpg</front_img><back_img>barcode/dr/36b.jpg</back_img><barcode></barcode></item><item><name>パーフェクト</name><front_img>barcode/dr/37f.jpg</front_img><back_img>barcode/dr/37b.jpg</back_img><barcode></barcode></item><item><name>パーフェクト</name><front_img>barcode/dr/38f.jpg</front_img><back_img>barcode/dr/38b.jpg</back_img><barcode>5291420215159</barcode></item><item><name>パーフェクト</name><front_img>barcode/dr/39f.jpg</front_img><back_img>barcode/dr/39b.jpg</back_img><barcode></barcode></item><item><name>パーフェクト</name><front_img>barcode/dr/40f.jpg</front_img><back_img>barcode/dr/40b.jpg</back_img><barcode></barcode></item></root>",
    "xml/ds.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>セリオス</name><front_img>barcode/ds/1f.jpg</front_img><back_img>barcode/ds/1b.jpg</back_img><barcode></barcode></item><item><name>ゲイル</name><front_img>barcode/ds/2f.jpg</front_img><back_img>barcode/ds/2b.jpg</back_img><barcode></barcode></item><item><name>リュナン</name><front_img>barcode/ds/3f.jpg</front_img><back_img>barcode/ds/3b.jpg</back_img><barcode></barcode></item><item><name>ソニア</name><front_img>barcode/ds/4f.jpg</front_img><back_img>barcode/ds/4b.jpg</back_img><barcode></barcode></item><item><name>オプナの指輪</name><front_img>barcode/ds/5f.jpg</front_img><back_img>barcode/ds/5b.jpg</back_img><barcode></barcode></item><item><name>光の剣</name><front_img>barcode/ds/6f.jpg</front_img><back_img>barcode/ds/6b.jpg</back_img><barcode></barcode></item><item><name>聖なる杖</name><front_img>barcode/ds/7f.jpg</front_img><back_img>barcode/ds/7b.jpg</back_img><barcode></barcode></item><item><name>テュトの指輪</name><front_img>barcode/ds/8f.jpg</front_img><back_img>barcode/ds/8b.jpg</back_img><barcode></barcode></item><item><name>幸運＆不幸のタロット</name><front_img>barcode/ds/9f.jpg</front_img><back_img>barcode/ds/9b.jpg</back_img><barcode></barcode></item><item><name>いやしのローブ</name><front_img>barcode/ds/10f.jpg</front_img><back_img>barcode/ds/10b.jpg</back_img><barcode></barcode></item><item><name>ビスの実</name><front_img>barcode/ds/11f.jpg</front_img><back_img>barcode/ds/11b.jpg</back_img><barcode></barcode></item><item><name>レスの葉</name><front_img>barcode/ds/12f.jpg</front_img><back_img>barcode/ds/12b.jpg</back_img><barcode></barcode></item><item><name>キャリオンクローラー</name><front_img>barcode/ds/13f.jpg</front_img><back_img>barcode/ds/13b.jpg</back_img><barcode></barcode></item><item><name>ハサミムシ</name><front_img>barcode/ds/14f.jpg</front_img><back_img>barcode/ds/14b.jpg</back_img><barcode></barcode></item><item><name>エラビ</name><front_img>barcode/ds/15f.jpg</front_img><back_img>barcode/ds/15b.jpg</back_img><barcode></barcode></item><item><name>眼力魔</name><front_img>barcode/ds/16f.jpg</front_img><back_img>barcode/ds/16b.jpg</back_img><barcode></barcode></item><item><name>デスクラブ</name><front_img>barcode/ds/17f.jpg</front_img><back_img>barcode/ds/17b.jpg</back_img><barcode></barcode></item><item><name>ボイルガード</name><front_img>barcode/ds/18f.jpg</front_img><back_img>barcode/ds/18b.jpg</back_img><barcode></barcode></item><item><name>ツノコブラ</name><front_img>barcode/ds/19f.jpg</front_img><back_img>barcode/ds/19b.jpg</back_img><barcode></barcode></item><item><name>カミナリグイ</name><front_img>barcode/ds/20f.jpg</front_img><back_img>barcode/ds/20b.jpg</back_img><barcode></barcode></item><item><name>ギュリゲス</name><front_img>barcode/ds/21f.jpg</front_img><back_img>barcode/ds/21b.jpg</back_img><barcode></barcode></item><item><name>ジャイアントエイプ</name><front_img>barcode/ds/22f.jpg</front_img><back_img>barcode/ds/22b.jpg</back_img><barcode></barcode></item><item><name>サラマンダー</name><front_img>barcode/ds/23f.jpg</front_img><back_img>barcode/ds/23b.jpg</back_img><barcode></barcode></item><item><name>ガリュバス</name><front_img>barcode/ds/24f.jpg</front_img><back_img>barcode/ds/24b.jpg</back_img><barcode></barcode></item><item><name>アクダム</name><front_img>barcode/ds/25f.jpg</front_img><back_img>barcode/ds/25b.jpg</back_img><barcode></barcode></item><item><name>シルフィ</name><front_img>barcode/ds/26f.jpg</front_img><back_img>barcode/ds/26b.jpg</back_img><barcode></barcode></item><item><name>鉄巨人</name><front_img>barcode/ds/27f.jpg</front_img><back_img>barcode/ds/27b.jpg</back_img><barcode></barcode></item><item><name>ガーバイン</name><front_img>barcode/ds/28f.jpg</front_img><back_img>barcode/ds/28b.jpg</back_img><barcode></barcode></item><item><name>バジール</name><front_img>barcode/ds/29f.jpg</front_img><back_img>barcode/ds/29b.jpg</back_img><barcode>1885054077777</barcode></item><item><name>アグニージャ</name><front_img>barcode/ds/30f.jpg</front_img><back_img>barcode/ds/30b.jpg</back_img><barcode></barcode></item></root>",
    "xml/g1.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>龍神ウーロンリー</name><front_img>barcode/g1/g1f.jpg</front_img><back_img>barcode/g1/g1b.jpg</back_img><barcode>0401207237501</barcode></item><item><name>聖闘士バーモンドクリフ</name><front_img>barcode/g1/g2f.jpg</front_img><back_img>barcode/g1/g2b.jpg</back_img><barcode>0341011384506</barcode></item><item><name>ボンドナイト</name><front_img>barcode/g1/g3f.jpg</front_img><back_img>barcode/g1/g3b.jpg</back_img><barcode>0521209429381</barcode></item><item><name>エスカンニチョップ</name><front_img>barcode/g1/g4f.jpg</front_img><back_img>barcode/g1/g4b.jpg</back_img><barcode>0551512179710</barcode></item><item><name>MAD・ラーク</name><front_img>barcode/g1/g5f.jpg</front_img><back_img>barcode/g1/g5b.jpg</back_img><barcode>0642013418764</barcode></item><item><name>アーモンドポッキリ</name><front_img>barcode/g1/g6f.jpg</front_img><back_img>barcode/g1/g6b.jpg</back_img><barcode>052316368252</barcode></item><item><name>マーボマックス</name><front_img>barcode/g1/g7f.jpg</front_img><back_img>barcode/g1/g7b.jpg</back_img><barcode>0601814354701</barcode></item><item><name>聖シャルダン</name><front_img>barcode/g1/g8f.jpg</front_img><back_img>barcode/g1/g8b.jpg</back_img><barcode>0682518275806</barcode></item><item><name>ティポン・カードロコ</name><front_img>barcode/g1/g9f.jpg</front_img><back_img>barcode/g1/g9b.jpg</back_img><barcode>0752716104700</barcode></item><item><name>リプトン・Ｔ</name><front_img>barcode/g1/g10f.jpg</front_img><back_img>barcode/g1/g10b.jpg</back_img><barcode>0792818344703</barcode></item><item><name>スキ邪鬼1000K</name><front_img>barcode/g1/g11f.jpg</front_img><back_img>barcode/g1/g11b.jpg</back_img><barcode>0873020325657</barcode></item><item><name>バドーワイザー</name><front_img>barcode/g1/g12f.jpg</front_img><back_img>barcode/g1/g12b.jpg</back_img><barcode>0842927378288</barcode></item><item><name>トンガリコンＧ</name><front_img>barcode/g1/g13f.jpg</front_img><back_img>barcode/g1/g13b.jpg</back_img><barcode>0963225309764</barcode></item><item><name>麻シャンヌ</name><front_img>barcode/g1/g14f.jpg</front_img><back_img>barcode/g1/g14b.jpg</back_img><barcode>1003430079812</barcode></item><item><name>バーモントクリフ</name><front_img>barcode/g1/g15f.jpg</front_img><back_img>barcode/g1/g15b.jpg</back_img><barcode>1153229269235</barcode></item><item><name>エビセンマン</name><front_img>barcode/g1/g16f.jpg</front_img><back_img>barcode/g1/g16b.jpg</back_img><barcode>1203531475654</barcode></item><item><name>オリゴンC2</name><front_img>barcode/g1/g17f.jpg</front_img><back_img>barcode/g1/g17b.jpg</back_img><barcode>1253833055719</barcode></item><item><name>カロピスナイト</name><front_img>barcode/g1/g18f.jpg</front_img><back_img>barcode/g1/g18b.jpg</back_img><barcode>1383634085766</barcode></item><item><name>コマンドＬＰ</name><front_img>barcode/g1/g19f.jpg</front_img><back_img>barcode/g1/g19b.jpg</back_img><barcode>1474036245664</barcode></item><item><name>ジャイブ鋼火</name><front_img>barcode/g1/g20f.jpg</front_img><back_img>barcode/g1/g20b.jpg</back_img><barcode>1544235125774</barcode></item><item><name>ダダーンＰ</name><front_img>barcode/g1/g21f.jpg</front_img><back_img>barcode/g1/g21b.jpg</back_img><barcode>1603938185284</barcode></item><item><name>KRブライトン</name><front_img>barcode/g1/g22f.jpg</front_img><back_img>barcode/g1/g22b.jpg</back_img><barcode>1734337205713</barcode></item><item><name>白魔術王ホカロンダー</name><front_img>barcode/g1/g23f.jpg</front_img><back_img>barcode/g1/g23b.jpg</back_img><barcode>1954840299829</barcode></item><item><name>ニンニクエキス</name><front_img>barcode/g1/g24f.jpg</front_img><back_img>barcode/g1/g24b.jpg</back_img><barcode>0160000903159</barcode></item><item><name>小銭</name><front_img>barcode/g1/g25f.jpg</front_img><back_img>barcode/g1/g25b.jpg</back_img><barcode>0120000903115</barcode></item><item><name>流水剣</name><front_img>barcode/g1/g26f.jpg</front_img><back_img>barcode/g1/g26b.jpg</back_img><barcode>0000600602017</barcode></item><item><name>二枚刃ブーメラン</name><front_img>barcode/g1/g27f.jpg</front_img><back_img>barcode/g1/g27b.jpg</back_img><barcode>0001400500022</barcode></item><item><name>魔法の風呂敷</name><front_img>barcode/g1/g28f.jpg</front_img><back_img>barcode/g1/g28b.jpg</back_img><barcode>0000010802212</barcode></item><item><name>力の指輪</name><front_img>barcode/g1/g29f.jpg</front_img><back_img>barcode/g1/g29b.jpg</back_img><barcode>0000019700328</barcode></item><item><name>魔法のカバン</name><front_img>barcode/g1/g30f.jpg</front_img><back_img>barcode/g1/g30b.jpg</back_img><barcode>0000006990077</barcode></item><item><name>ポプリの実</name><front_img>barcode/g1/g31f.jpg</front_img><back_img>barcode/g1/g31b.jpg</back_img><barcode>0000600970444</barcode></item></root>",
    "xml/g2.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>魔剣士活武</name><front_img>barcode/g2/g32f.jpg</front_img><back_img>barcode/g2/g32b.jpg</back_img><barcode>0421305134502</barcode></item><item><name>麗剣士プリンセスグミー</name><front_img>barcode/g2/g33f.jpg</front_img><back_img>barcode/g2/g33b.jpg</back_img><barcode>0361110484501</barcode></item><item><name>エンゼルハイ</name><front_img>barcode/g2/g34f.jpg</front_img><back_img>barcode/g2/g34b.jpg</back_img><barcode>0491406078715</barcode></item><item><name>陽怒乱光</name><front_img>barcode/g2/g35f.jpg</front_img><back_img>barcode/g2/g35b.jpg</back_img><barcode>0672410005809</barcode></item><item><name>デルモンテス</name><front_img>barcode/g2/g36f.jpg</front_img><back_img>barcode/g2/g36b.jpg</back_img><barcode>0852718175651</barcode></item><item><name>ムーニー・リー</name><front_img>barcode/g2/g37f.jpg</front_img><back_img>barcode/g2/g37b.jpg</back_img><barcode>0772925115779</barcode></item><item><name>キットカーン</name><front_img>barcode/g2/g38f.jpg</front_img><back_img>barcode/g2/g38b.jpg</back_img><barcode>1003023025707</barcode></item><item><name>ハイチュー鬼</name><front_img>barcode/g2/g39f.jpg</front_img><back_img>barcode/g2/g39b.jpg</back_img><barcode>1103335335812</barcode></item><item><name>魔ジック</name><front_img>barcode/g2/g40f.jpg</front_img><back_img>barcode/g2/g40b.jpg</back_img><barcode>1313526275753</barcode></item><item><name>ボリンキー</name><front_img>barcode/g2/g41f.jpg</front_img><back_img>barcode/g2/g41b.jpg</back_img><barcode>1403934047766</barcode></item><item><name>リー・ケイン</name><front_img>barcode/g2/g42f.jpg</front_img><back_img>barcode/g2/g42b.jpg</back_img><barcode>1553730157715</barcode></item><item><name>華麗妖美</name><front_img>barcode/g2/g43f.jpg</front_img><back_img>barcode/g2/g43b.jpg</back_img><barcode>1604238375825</barcode></item><item><name>サクセス・ニック</name><front_img>barcode/g2/g44f.jpg</front_img><back_img>barcode/g2/g44b.jpg</back_img><barcode>1744435064662</barcode></item><item><name>鋼帝ミロ</name><front_img>barcode/g2/g45f.jpg</front_img><back_img>barcode/g2/g45b.jpg</back_img><barcode>1984736163712</barcode></item><item><name>写ランデス</name><front_img>barcode/g2/g46f.jpg</front_img><back_img>barcode/g2/g46b.jpg</back_img><barcode>1864541475777</barcode></item><item><name>プレミアヌス一世</name><front_img>barcode/g2/g47f.jpg</front_img><back_img>barcode/g2/g47b.jpg</back_img><barcode>2094943325281</barcode></item><item><name>コーンフレッカー</name><front_img>barcode/g2/g48f.jpg</front_img><back_img>barcode/g2/g48b.jpg</back_img><barcode>2195540425722</barcode></item><item><name>ティモテ姫</name><front_img>barcode/g2/g49f.jpg</front_img><back_img>barcode/g2/g49b.jpg</back_img><barcode>2395941385230</barcode></item><item><name>妖命洲</name><front_img>barcode/g2/g50f.jpg</front_img><back_img>barcode/g2/g50b.jpg</back_img><barcode>2495744345711</barcode></item><item><name>デンタックP</name><front_img>barcode/g2/g51f.jpg</front_img><back_img>barcode/g2/g51b.jpg</back_img><barcode>2296446465765</barcode></item><item><name>ハーゲンダッツ将軍</name><front_img>barcode/g2/g52f.jpg</front_img><back_img>barcode/g2/g52b.jpg</back_img><barcode>2696043365176</barcode></item><item><name>アポロンチョコネス</name><front_img>barcode/g2/g53f.jpg</front_img><back_img>barcode/g2/g53b.jpg</back_img><barcode>2596245485255</barcode></item><item><name>古魔術王グロンサンダー</name><front_img>barcode/g2/g54f.jpg</front_img><back_img>barcode/g2/g54b.jpg</back_img><barcode>2796553395332</barcode></item><item><name>戦略ビデオカセット</name><front_img>barcode/g2/g55f.jpg</front_img><back_img>barcode/g2/g55b.jpg</back_img><barcode>0180000904307</barcode></item><item><name>カラーリンス</name><front_img>barcode/g2/g56f.jpg</front_img><back_img>barcode/g2/g56b.jpg</back_img><barcode>0140000904127</barcode></item><item><name>超磁動ガン</name><front_img>barcode/g2/g57f.jpg</front_img><back_img>barcode/g2/g57b.jpg</back_img><barcode>0007000603255</barcode></item><item><name>灼熱ランサー</name><front_img>barcode/g2/g58f.jpg</front_img><back_img>barcode/g2/g58b.jpg</back_img><barcode>0001500050083</barcode></item><item><name>琺瑯のたて</name><front_img>barcode/g2/g59f.jpg</front_img><back_img>barcode/g2/g59b.jpg</back_img><barcode>0000012802043</barcode></item><item><name>ゲタ</name><front_img>barcode/g2/g60f.jpg</front_img><back_img>barcode/g2/g60b.jpg</back_img><barcode>0000014802058</barcode></item><item><name>きびだんご</name><front_img>barcode/g2/g61f.jpg</front_img><back_img>barcode/g2/g61b.jpg</back_img><barcode>0000007990038</barcode></item><item><name>うさぎの爪</name><front_img>barcode/g2/g62f.jpg</front_img><back_img>barcode/g2/g62b.jpg</back_img><barcode>0000700970375</barcode></item></root>",
    "xml/g3.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>G・Mマックスフライ</name><front_img>barcode/g3/g63f.jpg</front_img><back_img>barcode/g3/g63b.jpg</back_img><barcode></barcode></item><item><name>烈亭中華妖舞</name><front_img>barcode/g3/g64f.jpg</front_img><back_img>barcode/g3/g64b.jpg</back_img><barcode></barcode></item><item><name>勘太郎</name><front_img>barcode/g3/g65f.jpg</front_img><back_img>barcode/g3/g65b.jpg</back_img><barcode></barcode></item><item><name>雪見大五郎</name><front_img>barcode/g3/g66f.jpg</front_img><back_img>barcode/g3/g66b.jpg</back_img><barcode></barcode></item><item><name>華麗鋼坊</name><front_img>barcode/g3/g67f.jpg</front_img><back_img>barcode/g3/g67b.jpg</back_img><barcode></barcode></item><item><name>マーブルチョン</name><front_img>barcode/g3/g68f.jpg</front_img><back_img>barcode/g3/g68b.jpg</back_img><barcode></barcode></item><item><name>径光刀</name><front_img>barcode/g3/g69f.jpg</front_img><back_img>barcode/g3/g69b.jpg</back_img><barcode></barcode></item><item><name>ノリタ魔</name><front_img>barcode/g3/g70f.jpg</front_img><back_img>barcode/g3/g70b.jpg</back_img><barcode></barcode></item><item><name>ジャワTS</name><front_img>barcode/g3/g71f.jpg</front_img><back_img>barcode/g3/g71b.jpg</back_img><barcode></barcode></item><item><name>燐風</name><front_img>barcode/g3/g72f.jpg</front_img><back_img>barcode/g3/g72b.jpg</back_img><barcode></barcode></item><item><name>ホチキッス</name><front_img>barcode/g3/g73f.jpg</front_img><back_img>barcode/g3/g73b.jpg</back_img><barcode></barcode></item><item><name>怨浴刀</name><front_img>barcode/g3/g74f.jpg</front_img><back_img>barcode/g3/g74b.jpg</back_img><barcode></barcode></item><item><name>キューティーザーネ</name><front_img>barcode/g3/g75f.jpg</front_img><back_img>barcode/g3/g75b.jpg</back_img><barcode></barcode></item><item><name>水戸鳴戸</name><front_img>barcode/g3/g76f.jpg</front_img><back_img>barcode/g3/g76b.jpg</back_img><barcode></barcode></item><item><name>クレンザーダ</name><front_img>barcode/g3/g77f.jpg</front_img><back_img>barcode/g3/g77b.jpg</back_img><barcode></barcode></item><item><name>ハードムース</name><front_img>barcode/g3/g78f.jpg</front_img><back_img>barcode/g3/g78b.jpg</back_img><barcode></barcode></item><item><name>照美寿</name><front_img>barcode/g3/g79f.jpg</front_img><back_img>barcode/g3/g79b.jpg</back_img><barcode></barcode></item><item><name>ハイネケン大佐</name><front_img>barcode/g3/g80f.jpg</front_img><back_img>barcode/g3/g80b.jpg</back_img><barcode></barcode></item><item><name>アクローン</name><front_img>barcode/g3/g81f.jpg</front_img><back_img>barcode/g3/g81b.jpg</back_img><barcode></barcode></item><item><name>源海</name><front_img>barcode/g3/g82f.jpg</front_img><back_img>barcode/g3/g82b.jpg</back_img><barcode>3296752465410</barcode></item><item><name>ネクター将軍</name><front_img>barcode/g3/g83f.jpg</front_img><back_img>barcode/g3/g83b.jpg</back_img><barcode></barcode></item><item><name>美出王</name><front_img>barcode/g3/g84f.jpg</front_img><back_img>barcode/g3/g84b.jpg</back_img><barcode></barcode></item><item><name>大重神コピーダ</name><front_img>barcode/g3/g85f.jpg</front_img><back_img>barcode/g3/g85b.jpg</back_img><barcode></barcode></item><item><name>黒魔術王パノラマンダー</name><front_img>barcode/g3/g86f.jpg</front_img><back_img>barcode/g3/g86b.jpg</back_img><barcode></barcode></item><item><name>聖水</name><front_img>barcode/g3/g87f.jpg</front_img><back_img>barcode/g3/g87b.jpg</back_img><barcode></barcode></item><item><name>弓龍剣</name><front_img>barcode/g3/g88f.jpg</front_img><back_img>barcode/g3/g88b.jpg</back_img><barcode></barcode></item><item><name>リモコン波動砲</name><front_img>barcode/g3/g89f.jpg</front_img><back_img>barcode/g3/g89b.jpg</back_img><barcode></barcode></item><item><name>フロントホックアーマー</name><front_img>barcode/g3/g90f.jpg</front_img><back_img>barcode/g3/g90b.jpg</back_img><barcode></barcode></item><item><name>コンタクトレンズ</name><front_img>barcode/g3/g91f.jpg</front_img><back_img>barcode/g3/g91b.jpg</back_img><barcode></barcode></item><item><name>魔法のコービー</name><front_img>barcode/g3/g92f.jpg</front_img><back_img>barcode/g3/g92b.jpg</back_img><barcode></barcode></item><item><name>スッポン草</name><front_img>barcode/g3/g93f.jpg</front_img><back_img>barcode/g3/g93b.jpg</back_img><barcode></barcode></item></root>",
    "xml/jl.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>横浜フリューゲルス</name><front_img>barcode/jl/ASFlugelsF.jpg</front_img><back_img>barcode/jl/ASFlugelsB.jpg</back_img><barcode></barcode></item><item><name>ベルマーレ平塚</name><front_img>barcode/jl/BellmareF.jpg</front_img><back_img>barcode/jl/BellmareB.jpg</back_img><barcode>0000000014113</barcode></item><item><name>ジェフユナイテッド市原</name><front_img>barcode/jl/JEFUnitedF.jpg</front_img><back_img>barcode/jl/JEFUnitedB.jpg</back_img><barcode>0000000102711</barcode></item><item><name>ジュビロ磐田</name><front_img>barcode/jl/JubiloIwataF.jpg</front_img><back_img>barcode/jl/JubiloIwataB.jpg</back_img><barcode></barcode></item><item><name>鹿島アントラーズ</name><front_img>barcode/jl/KashimaAntlersF.jpg</front_img><back_img>barcode/jl/KashimaAntlersB.jpg</back_img><barcode>0000000291040</barcode></item><item><name>名古屋グランパスエイト</name><front_img>barcode/jl/NagoyaGrampus8F.jpg</front_img><back_img>barcode/jl/NagoyaGrampus8B.jpg</back_img><barcode></barcode></item><item><name>横浜マリノス</name><front_img>barcode/jl/NissanFCYokohamaMarinosF.jpg</front_img><back_img>barcode/jl/NissanFCYokohamaMarinosB.jpg</back_img><barcode>0000000261401</barcode></item><item><name>ガンバ大阪</name><front_img>barcode/jl/PanasonicGambaOsakaF.jpg</front_img><back_img>barcode/jl/PanasonicGambaOsakaB.jpg</back_img><barcode></barcode></item><item><name>浦和レッドダイヤモンズ</name><front_img>barcode/jl/RedDiamondsF.jpg</front_img><back_img>barcode/jl/RedDiamondsB.jpg</back_img><barcode></barcode></item><item><name>サンフレッチェ広島</name><front_img>barcode/jl/SanfrecceHiroshimaFCF.jpg</front_img><back_img>barcode/jl/SanfrecceHiroshimaFCB.jpg</back_img><barcode></barcode></item><item><name>清水エスパルス</name><front_img>barcode/jl/ShimizuSPulseF.jpg</front_img><back_img>barcode/jl/ShimizuSPulseB.jpg</back_img><barcode></barcode></item><item><name>ヴェルディ川崎</name><front_img>barcode/jl/VerdyYomiuriF.jpg</front_img><back_img>barcode/jl/VerdyYomiuriB.jpg</back_img><barcode>0000000632171</barcode></item></root>",
    "xml/limit.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>チャーハン帝</name><front_img>barcode/limit/1f.jpg</front_img><back_img>barcode/limit/1b.jpg</back_img><barcode></barcode></item></root>",
    "xml/list.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>バーコードバトラーII付属カード</name><xml>bb2.xml</xml></item><item><name>バーコードバトラーII 時空を超えた戦士たち(ボードゲーム) 付属カード</name><xml>bb2b.xml</xml></item><item><name>限定カード</name><xml>limit.xml</xml></item><item><name>コンビニウォーズ外伝1～白魔術王ホカロンダーの陰謀～</name><xml>g1.xml</xml></item><item><name>コンビニウォーズ外伝2～古魔術王グロンサンダーの復讐～</name><xml>g2.xml</xml></item><item><name>コンビニウォーズ外伝3～最後の死闘!VS黒魔術王パノラマンダー～</name><xml>g3.xml</xml></item><item><name>コンビニウォーズ正伝1～超パワー生命体！ダークバーコード星人登場！！～</name><xml>s1.xml</xml></item><item><name>コンビニウォーズ正伝2～超合体伝説～</name><xml>s2.xml</xml></item><item><name>コンビニウォーズ正伝3～精霊伝説～(バーコードバトラーIIダブルC2用ソフト)</name><xml>s3.xml</xml></item><item><name>コンビニウォーズ正伝4～精霊伝説～(バーコードバトラーIIダブルC2用ソフト)</name><xml>s4.xml</xml></item><item><name>小田急ステーションウォーズ</name><xml>oda.xml</xml></item><item><name>バーコードワールド付属カード</name><xml>bw.xml</xml></item><item><name>バーコードファイター(コロコロコミック付属カード)</name><xml>bfc.xml</xml></item><item><name>バーコードファイター～バーコードファイター 来襲！機械竜軍団！！～</name><xml>bf2.xml</xml></item><item><name>バーコードバトラーII 必勝道具箱</name><xml>bungu.xml</xml></item><item><name>ゼルダの伝説～神々のトライフォース～</name><xml>loz.xml</xml></item><item><name>ドラゴンスレイヤー英雄伝説</name><xml>ds.xml</xml></item><item><name>スーパーマリオワールド</name><xml>smw.xml</xml></item><item><name>スーパーマリオカート</name><xml>mct.xml</xml></item><item><name>ドラえもん のび太の恐竜</name><xml>dr.xml</xml></item><item><name>Jリーグ エキサイトステージ'94</name><xml>jl.xml</xml></item></root>",
    "xml/loz.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>リンク</name><front_img>barcode/loz/1f.jpg</front_img><back_img>barcode/loz/1b.jpg</back_img><barcode></barcode></item><item><name>リンク(魔法)</name><front_img>barcode/loz/2f.jpg</front_img><back_img>barcode/loz/2b.jpg</back_img><barcode></barcode></item><item><name>ブーメラン</name><front_img>barcode/loz/3f.jpg</front_img><back_img>barcode/loz/3b.jpg</back_img><barcode></barcode></item><item><name>フックショット</name><front_img>barcode/loz/4f.jpg</front_img><back_img>barcode/loz/4b.jpg</back_img><barcode></barcode></item><item><name>銀の弓矢</name><front_img>barcode/loz/5f.jpg</front_img><back_img>barcode/loz/5b.jpg</back_img><barcode></barcode></item><item><name>ばくだん</name><front_img>barcode/loz/6f.jpg</front_img><back_img>barcode/loz/6b.jpg</back_img><barcode></barcode></item><item><name>回転斬り</name><front_img>barcode/loz/7f.jpg</front_img><back_img>barcode/loz/7b.jpg</back_img><barcode></barcode></item><item><name>ペガサスの靴</name><front_img>barcode/loz/8f.jpg</front_img><back_img>barcode/loz/8b.jpg</back_img><barcode></barcode></item><item><name>マジックマント</name><front_img>barcode/loz/9f.jpg</front_img><back_img>barcode/loz/9b.jpg</back_img><barcode></barcode></item><item><name>ハート</name><front_img>barcode/loz/10f.jpg</front_img><back_img>barcode/loz/10b.jpg</back_img><barcode></barcode></item><item><name>魔法の壺</name><front_img>barcode/loz/11f.jpg</front_img><back_img>barcode/loz/11b.jpg</back_img><barcode></barcode></item><item><name>赤いくすり</name><front_img>barcode/loz/12f.jpg</front_img><back_img>barcode/loz/12b.jpg</back_img><barcode></barcode></item><item><name>ヤリ兵士</name><front_img>barcode/loz/13f.jpg</front_img><back_img>barcode/loz/13b.jpg</back_img><barcode></barcode></item><item><name>バリ</name><front_img>barcode/loz/14f.jpg</front_img><back_img>barcode/loz/14b.jpg</back_img><barcode></barcode></item><item><name>ゲルドマン</name><front_img>barcode/loz/15f.jpg</front_img><back_img>barcode/loz/15b.jpg</back_img><barcode></barcode></item><item><name>ウィズローブ</name><front_img>barcode/loz/16f.jpg</front_img><back_img>barcode/loz/16b.jpg</back_img><barcode></barcode></item><item><name>スタルフォン</name><front_img>barcode/loz/17f.jpg</front_img><back_img>barcode/loz/17b.jpg</back_img><barcode></barcode></item><item><name>ゾーラ</name><front_img>barcode/loz/18f.jpg</front_img><back_img>barcode/loz/18b.jpg</back_img><barcode></barcode></item><item><name>ヒップループ</name><front_img>barcode/loz/19f.jpg</front_img><back_img>barcode/loz/19b.jpg</back_img><barcode></barcode></item><item><name>モリブリン</name><front_img>barcode/loz/20f.jpg</front_img><back_img>barcode/loz/20b.jpg</back_img><barcode></barcode></item><item><name>コッピ</name><front_img>barcode/loz/21f.jpg</front_img><back_img>barcode/loz/21b.jpg</back_img><barcode></barcode></item><item><name>デグテール</name><front_img>barcode/loz/22f.jpg</front_img><back_img>barcode/loz/22b.jpg</back_img><barcode></barcode></item><item><name>ガプラ</name><front_img>barcode/loz/23f.jpg</front_img><back_img>barcode/loz/23b.jpg</back_img><barcode></barcode></item><item><name>鉄球兵士</name><front_img>barcode/loz/24f.jpg</front_img><back_img>barcode/loz/24b.jpg</back_img><barcode></barcode></item><item><name>ヒノックス</name><front_img>barcode/loz/25f.jpg</front_img><back_img>barcode/loz/25b.jpg</back_img><barcode></barcode></item><item><name>アグニム</name><front_img>barcode/loz/26f.jpg</front_img><back_img>barcode/loz/26b.jpg</back_img><barcode></barcode></item><item><name>ギブド</name><front_img>barcode/loz/27f.jpg</front_img><back_img>barcode/loz/27b.jpg</back_img><barcode></barcode></item><item><name>ジークロック</name><front_img>barcode/loz/28f.jpg</front_img><back_img>barcode/loz/28b.jpg</back_img><barcode></barcode></item><item><name>ワート</name><front_img>barcode/loz/29f.jpg</front_img><back_img>barcode/loz/29b.jpg</back_img><barcode>1885054077777</barcode></item><item><name>ガノン</name><front_img>barcode/loz/30f.jpg</front_img><back_img>barcode/loz/30b.jpg</back_img><barcode></barcode></item></root>",
    "xml/mct.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>マリオ</name><front_img>barcode/mct/1f.jpg</front_img><back_img>barcode/mct/1b.jpg</back_img><barcode>7000070000262</barcode></item><item><name>ルイージ</name><front_img>barcode/mct/2f.jpg</front_img><back_img>barcode/mct/2b.jpg</back_img><barcode>2000070007778</barcode></item><item><name>ヨッシー</name><front_img>barcode/mct/3f.jpg</front_img><back_img>barcode/mct/3b.jpg</back_img><barcode>800007000162</barcode></item><item><name>ピーチ姫</name><front_img>barcode/mct/4f.jpg</front_img><back_img>barcode/mct/4b.jpg</back_img><barcode>4000070071043</barcode></item><item><name>クッパ</name><front_img>barcode/mct/5f.jpg</front_img><back_img>barcode/mct/5b.jpg</back_img><barcode>6000071001382</barcode></item><item><name>ドンキーコングJr.</name><front_img>barcode/mct/6f.jpg</front_img><back_img>barcode/mct/6b.jpg</back_img><barcode>2000070000281</barcode></item><item><name>ノコノコ</name><front_img>barcode/mct/7f.jpg</front_img><back_img>barcode/mct/7b.jpg</back_img><barcode>3000071789153</barcode></item><item><name>キノピオ</name><front_img>barcode/mct/8f.jpg</front_img><back_img>barcode/mct/8b.jpg</back_img><barcode>5000079070053</barcode></item><item><name>土管</name><front_img>barcode/mct/9f.jpg</front_img><back_img>barcode/mct/9b.jpg</back_img><barcode>2298040405475</barcode></item><item><name>バナナの皮</name><front_img>barcode/mct/10f.jpg</front_img><back_img>barcode/mct/10b.jpg</back_img><barcode>0878787121191</barcode></item><item><name>オイル</name><front_img>barcode/mct/11f.jpg</front_img><back_img>barcode/mct/11b.jpg</back_img><barcode>1888888101496</barcode></item><item><name>パックンフラワー</name><front_img>barcode/mct/12f.jpg</front_img><back_img>barcode/mct/12b.jpg</back_img><barcode>2896056305255</barcode></item><item><name>プクプク</name><front_img>barcode/mct/13f.jpg</front_img><back_img>barcode/mct/13b.jpg</back_img><barcode>2797570315464</barcode></item><item><name>池</name><front_img>barcode/mct/14f.jpg</front_img><back_img>barcode/mct/14b.jpg</back_img><barcode>4598000305417</barcode></item><item><name>泥</name><front_img>barcode/mct/15f.jpg</front_img><back_img>barcode/mct/15b.jpg</back_img><barcode>4097843305412</barcode></item><item><name>チョロプー</name><front_img>barcode/mct/16f.jpg</front_img><back_img>barcode/mct/16b.jpg</back_img><barcode>3098080315425</barcode></item><item><name>たまご</name><front_img>barcode/mct/17f.jpg</front_img><back_img>barcode/mct/17b.jpg</back_img><barcode>2797080415289</barcode></item><item><name>ジャンプバン</name><front_img>barcode/mct/18f.jpg</front_img><back_img>barcode/mct/18b.jpg</back_img><barcode>3399988305571</barcode></item><item><name>火の玉</name><front_img>barcode/mct/19f.jpg</front_img><back_img>barcode/mct/19b.jpg</back_img><barcode>1997770131234</barcode></item><item><name>ドッスン</name><front_img>barcode/mct/20f.jpg</front_img><back_img>barcode/mct/20b.jpg</back_img><barcode>0009900056186</barcode></item><item><name>土管×３</name><front_img>barcode/mct/21f.jpg</front_img><back_img>barcode/mct/21b.jpg</back_img><barcode>3299095305566</barcode></item><item><name>ダッシュバン</name><front_img>barcode/mct/22f.jpg</front_img><back_img>barcode/mct/22b.jpg</back_img><barcode>3399988305571</barcode></item><item><name>ジュゲム</name><front_img>barcode/mct/23f.jpg</front_img><back_img>barcode/mct/23b.jpg</back_img><barcode>0000100300130</barcode></item><item><name>スター</name><front_img>barcode/mct/24f.jpg</front_img><back_img>barcode/mct/24b.jpg</back_img><barcode>0070707300185</barcode></item><item><name>キノコ</name><front_img>barcode/mct/25f.jpg</front_img><back_img>barcode/mct/25b.jpg</back_img><barcode>0000000006446</barcode></item><item><name>ミドリ甲羅</name><front_img>barcode/mct/26f.jpg</front_img><back_img>barcode/mct/26b.jpg</back_img><barcode>0000400300489</barcode></item><item><name>アカ甲羅</name><front_img>barcode/mct/27f.jpg</front_img><back_img>barcode/mct/27b.jpg</back_img><barcode>0000600300388</barcode></item><item><name>羽根</name><front_img>barcode/mct/28f.jpg</front_img><back_img>barcode/mct/28b.jpg</back_img><barcode>0000005300518</barcode></item><item><name>コイン</name><front_img>barcode/mct/29f.jpg</front_img><back_img>barcode/mct/29b.jpg</back_img><barcode>0010101300008</barcode></item><item><name>イナヅマ</name><front_img>barcode/mct/30f.jpg</front_img><back_img>barcode/mct/30b.jpg</back_img><barcode>0000000300292</barcode></item></root>",
    "xml/oda.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>ロマンスカイザー[新宿]</name><front_img>barcode/oda/1f.jpg</front_img><back_img>barcode/oda/1b.jpg</back_img><barcode></barcode></item><item><name>超音波電雷笛[南新宿]</name><front_img>barcode/oda/2f.jpg</front_img><back_img>barcode/oda/2b.jpg</back_img><barcode></barcode></item><item><name>切り裂きジャッキ[参宮橋]</name><front_img>barcode/oda/3f.jpg</front_img><back_img>barcode/oda/3b.jpg</back_img><barcode></barcode></item><item><name>バリアハット[代々木八幡]</name><front_img>barcode/oda/4f.jpg</front_img><back_img>barcode/oda/4b.jpg</back_img><barcode></barcode></item><item><name>ウエハライオン[代々木上原]</name><front_img>barcode/oda/5f.jpg</front_img><back_img>barcode/oda/5b.jpg</back_img><barcode></barcode></item><item><name>超合金ハサミ[東北沢]</name><front_img>barcode/oda/6f.jpg</front_img><back_img>barcode/oda/6b.jpg</back_img><barcode></barcode></item><item><name>シモキタザウルス[下北沢]</name><front_img>barcode/oda/7f.jpg</front_img><back_img>barcode/oda/7b.jpg</back_img><barcode></barcode></item><item><name>打ち出の小旗[世田谷代田]</name><front_img>barcode/oda/8f.jpg</front_img><back_img>barcode/oda/8b.jpg</back_img><barcode></barcode></item><item><name>プラミー[梅ヶ丘]</name><front_img>barcode/oda/9f.jpg</front_img><back_img>barcode/oda/9b.jpg</back_img><barcode></barcode></item><item><name>招来寝子[豪徳寺]</name><front_img>barcode/oda/10f.jpg</front_img><back_img>barcode/oda/10b.jpg</back_img><barcode></barcode></item><item><name>キョウドン[経堂]</name><front_img>barcode/oda/11f.jpg</front_img><back_img>barcode/oda/11b.jpg</back_img><barcode></barcode></item><item><name>トレインボー[千歳船橋]</name><front_img>barcode/oda/12f.jpg</front_img><back_img>barcode/oda/12b.jpg</back_img><barcode></barcode></item><item><name>パワーウォッチ[鶴巻温泉]</name><front_img>barcode/oda/13f.jpg</front_img><back_img>barcode/oda/13b.jpg</back_img><barcode></barcode></item><item><name>トウカイダー[東海大学前]</name><front_img>barcode/oda/14f.jpg</front_img><back_img>barcode/oda/14b.jpg</back_img><barcode></barcode></item><item><name>トレインコップ[秦野]</name><front_img>barcode/oda/15f.jpg</front_img><back_img>barcode/oda/15b.jpg</back_img><barcode></barcode></item><item><name>シカメッツラー[渋沢]</name><front_img>barcode/oda/16f.jpg</front_img><back_img>barcode/oda/16b.jpg</back_img><barcode></barcode></item><item><name>ガントレットアンブレラ[新松田]</name><front_img>barcode/oda/17f.jpg</front_img><back_img>barcode/oda/17b.jpg</back_img><barcode></barcode></item><item><name>ダメージガード吊り手[開成]</name><front_img>barcode/oda/18f.jpg</front_img><back_img>barcode/oda/18b.jpg</back_img><barcode></barcode></item><item><name>レールミサイル[珀山]</name><front_img>barcode/oda/19f.jpg</front_img><back_img>barcode/oda/19b.jpg</back_img><barcode></barcode></item><item><name>パワーアップハンドル[富水]</name><front_img>barcode/oda/20f.jpg</front_img><back_img>barcode/oda/20b.jpg</back_img><barcode></barcode></item><item><name>ホタルンバ[蛍田]</name><front_img>barcode/oda/21f.jpg</front_img><back_img>barcode/oda/21b.jpg</back_img><barcode></barcode></item><item><name>防御踏切[足柄]</name><front_img>barcode/oda/22f.jpg</front_img><back_img>barcode/oda/22b.jpg</back_img><barcode></barcode></item><item><name>小田原ジョー[小田原]</name><front_img>barcode/oda/23f.jpg</front_img><back_img>barcode/oda/23b.jpg</back_img><barcode></barcode></item><item><name>ワープブリッジ[東林間]</name><front_img>barcode/oda/24f.jpg</front_img><back_img>barcode/oda/24b.jpg</back_img><barcode></barcode></item><item><name>防弾ヘルメット[祖師谷大蔵]</name><front_img>barcode/oda/25f.jpg</front_img><back_img>barcode/oda/25b.jpg</back_img><barcode></barcode></item><item><name>センロバスター[成城学園前]</name><front_img>barcode/oda/26f.jpg</front_img><back_img>barcode/oda/26b.jpg</back_img><barcode></barcode></item><item><name>合図灯型レーザー光線[喜多見]</name><front_img>barcode/oda/27f.jpg</front_img><back_img>barcode/oda/27b.jpg</back_img><barcode></barcode></item><item><name>ミラクルパワーキー[狛江]</name><front_img>barcode/oda/28f.jpg</front_img><back_img>barcode/oda/28b.jpg</back_img><barcode></barcode></item><item><name>ハイパー安全靴[和泉多摩川]</name><front_img>barcode/oda/29f.jpg</front_img><back_img>barcode/oda/29b.jpg</back_img><barcode></barcode></item><item><name>ロボリト[登戸]</name><front_img>barcode/oda/30f.jpg</front_img><back_img>barcode/oda/30b.jpg</back_img><barcode></barcode></item><item><name>モノレーラー[向ヶ丘遊園]</name><front_img>barcode/oda/31f.jpg</front_img><back_img>barcode/oda/31b.jpg</back_img><barcode></barcode></item><item><name>超音痴マイク[生田]</name><front_img>barcode/oda/32f.jpg</front_img><back_img>barcode/oda/32b.jpg</back_img><barcode></barcode></item><item><name>くだモモンガ[読売ランド前]</name><front_img>barcode/oda/33f.jpg</front_img><back_img>barcode/oda/33b.jpg</back_img><barcode></barcode></item><item><name>ユリルレロ[百合ヶ岡]</name><front_img>barcode/oda/34f.jpg</front_img><back_img>barcode/oda/34b.jpg</back_img><barcode></barcode></item><item><name>バス・ストンプ[新百合ヶ岡]</name><front_img>barcode/oda/35f.jpg</front_img><back_img>barcode/oda/35b.jpg</back_img><barcode></barcode></item><item><name>柿鉢念[柿生]</name><front_img>barcode/oda/36f.jpg</front_img><back_img>barcode/oda/36b.jpg</back_img><barcode></barcode></item><item><name>ハイパー定期[中央林間]</name><front_img>barcode/oda/37f.jpg</front_img><back_img>barcode/oda/37b.jpg</back_img><barcode></barcode></item><item><name>パワーシグナル[南林間]</name><front_img>barcode/oda/38f.jpg</front_img><back_img>barcode/oda/38b.jpg</back_img><barcode></barcode></item><item><name>ハイパー車輪[鶴間]</name><front_img>barcode/oda/39f.jpg</front_img><back_img>barcode/oda/39b.jpg</back_img><barcode></barcode></item><item><name>ヤマドリラー[大和]</name><front_img>barcode/oda/40f.jpg</front_img><back_img>barcode/oda/40b.jpg</back_img><barcode></barcode></item><item><name>サクランボー[桜ケ丘]</name><front_img>barcode/oda/41f.jpg</front_img><back_img>barcode/oda/41b.jpg</back_img><barcode></barcode></item><item><name>エネルギー供給パンタグラフ[高座渋谷]</name><front_img>barcode/oda/41f.jpg</front_img><back_img>barcode/oda/41b.jpg</back_img><barcode></barcode></item><item><name>蝶ゴン[長後]</name><front_img>barcode/oda/42f.jpg</front_img><back_img>barcode/oda/42b.jpg</back_img><barcode></barcode></item><item><name>パワー供給回数券[大和]</name><front_img>barcode/oda/43f.jpg</front_img><back_img>barcode/oda/43b.jpg</back_img><barcode></barcode></item><item><name>枕木砲[六会]</name><front_img>barcode/oda/44f.jpg</front_img><back_img>barcode/oda/44b.jpg</back_img><barcode></barcode></item><item><name>お守り懐中時計[善行]</name><front_img>barcode/oda/45f.jpg</front_img><back_img>barcode/oda/45b.jpg</back_img><barcode></barcode></item><item><name>プレート手裏剣[藤沢本町]</name><front_img>barcode/oda/47f.jpg</front_img><back_img>barcode/oda/47b.jpg</back_img><barcode></barcode></item><item><name>ロマンスカーボーイ[藤沢]</name><front_img>barcode/oda/48f.jpg</front_img><back_img>barcode/oda/48b.jpg</back_img><barcode></barcode></item><item><name>パワー切符[鶴川]</name><front_img>barcode/oda/49f.jpg</front_img><back_img>barcode/oda/49b.jpg</back_img><barcode></barcode></item><item><name>通KING KONG[玉川学園前]</name><front_img>barcode/oda/50f.jpg</front_img><back_img>barcode/oda/50b.jpg</back_img><barcode></barcode></item><item><name>ロマンス仮面[町田]</name><front_img>barcode/oda/51f.jpg</front_img><back_img>barcode/oda/51b.jpg</back_img><barcode></barcode></item><item><name>冴神王[相模大野]</name><front_img>barcode/oda/52f.jpg</front_img><back_img>barcode/oda/52b.jpg</back_img><barcode></barcode></item><item><name>ダイヤグラムレーダー[小田急相模原]</name><front_img>barcode/oda/53f.jpg</front_img><back_img>barcode/oda/53b.jpg</back_img><barcode></barcode></item><item><name>自動改札型マシンガン[相武台前]</name><front_img>barcode/oda/54f.jpg</front_img><back_img>barcode/oda/54b.jpg</back_img><barcode></barcode></item><item><name>パワー自動券売機[座間]</name><front_img>barcode/oda/55f.jpg</front_img><back_img>barcode/oda/55b.jpg</back_img><barcode></barcode></item><item><name>センロ観音[海老名]</name><front_img>barcode/oda/56f.jpg</front_img><back_img>barcode/oda/56b.jpg</back_img><barcode></barcode></item><item><name>アユビアン騎士[厚木]</name><front_img>barcode/oda/57f.jpg</front_img><back_img>barcode/oda/57b.jpg</back_img><barcode></barcode></item><item><name>ロマンスカーメン[本厚木]</name><front_img>barcode/oda/58f.jpg</front_img><back_img>barcode/oda/58b.jpg</back_img><barcode></barcode></item><item><name>時刻表示型バリア[愛甲石田]</name><front_img>barcode/oda/59f.jpg</front_img><back_img>barcode/oda/59b.jpg</back_img><barcode></barcode></item><item><name>スピードアップ速度計[伊勢原]</name><front_img>barcode/oda/60f.jpg</front_img><back_img>barcode/oda/60b.jpg</back_img><barcode></barcode></item><item><name>ハンマーパンチ[本鵜沼]</name><front_img>barcode/oda/61f.jpg</front_img><back_img>barcode/oda/61b.jpg</back_img><barcode></barcode></item><item><name>パワーシート[鵜沼海岸]</name><front_img>barcode/oda/62f.jpg</front_img><back_img>barcode/oda/62b.jpg</back_img><barcode></barcode></item><item><name>イルカルメン[片瀬江ノ島]</name><front_img>barcode/oda/63f.jpg</front_img><back_img>barcode/oda/63b.jpg</back_img><barcode></barcode></item><item><name>ミラクルブレーキ[五月台]</name><front_img>barcode/oda/64f.jpg</front_img><back_img>barcode/oda/64b.jpg</back_img><barcode></barcode></item><item><name>マロン・スワン[栗平]</name><front_img>barcode/oda/65f.jpg</front_img><back_img>barcode/oda/65b.jpg</back_img><barcode></barcode></item><item><name>ドッグ・ファイター[黒川]</name><front_img>barcode/oda/66f.jpg</front_img><back_img>barcode/oda/66b.jpg</back_img><barcode></barcode></item><item><name>ナガヤンマ[小田急永川]</name><front_img>barcode/oda/67f.jpg</front_img><back_img>barcode/oda/67b.jpg</back_img><barcode></barcode></item><item><name>グレーンバスター[小田急多摩センター]</name><front_img>barcode/oda/68f.jpg</front_img><back_img>barcode/oda/68b.jpg</back_img><barcode></barcode></item><item><name>カラテダー[唐木田]</name><front_img>barcode/oda/69f.jpg</front_img><back_img>barcode/oda/69b.jpg</back_img><barcode></barcode></item><item><name>オダQueen[達成記念]</name><front_img>barcode/oda/70f.jpg</front_img><back_img>barcode/oda/70b.jpg</back_img><barcode></barcode></item></root>",
    "xml/s1.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>マックスフライ</name><front_img>barcode/s1/111f.jpg</front_img><back_img>barcode/s1/111b.jpg</back_img><barcode></barcode></item><item><name>ウーロンリー</name><front_img>barcode/s1/112f.jpg</front_img><back_img>barcode/s1/112b.jpg</back_img><barcode></barcode></item><item><name>ラーメン活武</name><front_img>barcode/s1/113f.jpg</front_img><back_img>barcode/s1/113b.jpg</back_img><barcode></barcode></item><item><name>バーモンドクリフ</name><front_img>barcode/s1/114f.jpg</front_img><back_img>barcode/s1/114b.jpg</back_img><barcode></barcode></item><item><name>中華妖舞</name><front_img>barcode/s1/115f.jpg</front_img><back_img>barcode/s1/115b.jpg</back_img><barcode></barcode></item><item><name>プリンセスグミー</name><front_img>barcode/s1/116f.jpg</front_img><back_img>barcode/s1/116b.jpg</back_img><barcode></barcode></item><item><name>怪力朝潮</name><front_img>barcode/s1/117f.jpg</front_img><back_img>barcode/s1/117b.jpg</back_img><barcode></barcode></item><item><name>子将</name><front_img>barcode/s1/118f.jpg</front_img><back_img>barcode/s1/118b.jpg</back_img><barcode></barcode></item><item><name>謎の少女・純</name><front_img>barcode/s1/119f.jpg</front_img><back_img>barcode/s1/119b.jpg</back_img><barcode></barcode></item><item><name>レモン娘・しずく</name><front_img>barcode/s1/120f.jpg</front_img><back_img>barcode/s1/120b.jpg</back_img><barcode></barcode></item><item><name>麻づけの助</name><front_img>barcode/s1/121f.jpg</front_img><back_img>barcode/s1/121b.jpg</back_img><barcode></barcode></item><item><name>マザー</name><front_img>barcode/s1/122f.jpg</front_img><back_img>barcode/s1/122b.jpg</back_img><barcode></barcode></item><item><name>ミラーマン</name><front_img>barcode/s1/123f.jpg</front_img><back_img>barcode/s1/123b.jpg</back_img><barcode></barcode></item><item><name>収監少年サンディオ</name><front_img>barcode/s1/124f.jpg</front_img><back_img>barcode/s1/124b.jpg</back_img><barcode></barcode></item><item><name>富山の薬売り・能心</name><front_img>barcode/s1/125f.jpg</front_img><back_img>barcode/s1/125b.jpg</back_img><barcode></barcode></item><item><name>ランプのしもべ</name><front_img>barcode/s1/126f.jpg</front_img><back_img>barcode/s1/126b.jpg</back_img><barcode></barcode></item><item><name>再世紙トロールペーパー</name><front_img>barcode/s1/127f.jpg</front_img><back_img>barcode/s1/127b.jpg</back_img><barcode></barcode></item><item><name>無転化ゴーストラップ</name><front_img>barcode/s1/128f.jpg</front_img><back_img>barcode/s1/128b.jpg</back_img><barcode></barcode></item><item><name>デビルシスコーン</name><front_img>barcode/s1/129f.jpg</front_img><back_img>barcode/s1/129b.jpg</back_img><barcode></barcode></item><item><name>サイコメルシャンヌ</name><front_img>barcode/s1/130f.jpg</front_img><back_img>barcode/s1/130b.jpg</back_img><barcode></barcode></item><item><name>ダークバドーワイザー</name><front_img>barcode/s1/131f.jpg</front_img><back_img>barcode/s1/131b.jpg</back_img><barcode></barcode></item><item><name>デッドボトル</name><front_img>barcode/s1/132f.jpg</front_img><back_img>barcode/s1/132b.jpg</back_img><barcode></barcode></item><item><name>ブラックエビセンマン</name><front_img>barcode/s1/133f.jpg</front_img><back_img>barcode/s1/133b.jpg</back_img><barcode></barcode></item><item><name>ダーティーザーネ</name><front_img>barcode/s1/134f.jpg</front_img><back_img>barcode/s1/134b.jpg</back_img><barcode></barcode></item><item><name>狂力グロンサム</name><front_img>barcode/s1/135f.jpg</front_img><back_img>barcode/s1/135b.jpg</back_img><barcode></barcode></item><item><name>極悪焼酎力</name><front_img>barcode/s1/136f.jpg</front_img><back_img>barcode/s1/136b.jpg</back_img><barcode></barcode></item><item><name>陽怒乱暴</name><front_img>barcode/s1/137f.jpg</front_img><back_img>barcode/s1/137b.jpg</back_img><barcode></barcode></item><item><name>デスハイチュー鬼</name><front_img>barcode/s1/138f.jpg</front_img><back_img>barcode/s1/138b.jpg</back_img><barcode></barcode></item><item><name>ブラッドナンチューカ</name><front_img>barcode/s1/139f.jpg</front_img><back_img>barcode/s1/139b.jpg</back_img><barcode></barcode></item><item><name>化霊妖美</name><front_img>barcode/s1/140f.jpg</front_img><back_img>barcode/s1/140b.jpg</back_img><barcode></barcode></item><item><name>狂命洲</name><front_img>barcode/s1/141f.jpg</front_img><back_img>barcode/s1/141b.jpg</back_img><barcode></barcode></item><item><name>ゴーストサイダー</name><front_img>barcode/s1/142f.jpg</front_img><back_img>barcode/s1/142b.jpg</back_img><barcode></barcode></item><item><name>火夜帝プレミアヌス</name><front_img>barcode/s1/143f.jpg</front_img><back_img>barcode/s1/143b.jpg</back_img><barcode></barcode></item><item><name>ラガー鬼姫</name><front_img>barcode/s1/144f.jpg</front_img><back_img>barcode/s1/144b.jpg</back_img><barcode></barcode></item><item><name>写ランデスフラッシャー</name><front_img>barcode/s1/145f.jpg</front_img><back_img>barcode/s1/145b.jpg</back_img><barcode></barcode></item><item><name>血虎帝アポロン</name><front_img>barcode/s1/146f.jpg</front_img><back_img>barcode/s1/146b.jpg</back_img><barcode></barcode></item><item><name>闇径光刀</name><front_img>barcode/s1/147f.jpg</front_img><back_img>barcode/s1/147b.jpg</back_img><barcode></barcode></item><item><name>怒貧兵衛</name><front_img>barcode/s1/148f.jpg</front_img><back_img>barcode/s1/148b.jpg</back_img><barcode></barcode></item><item><name>美出王雷武</name><front_img>barcode/s1/149f.jpg</front_img><back_img>barcode/s1/149b.jpg</back_img><barcode></barcode></item><item><name>源海魔人</name><front_img>barcode/s1/150f.jpg</front_img><back_img>barcode/s1/150b.jpg</back_img><barcode></barcode></item><item><name>霊刀照美寿</name><front_img>barcode/s1/151f.jpg</front_img><back_img>barcode/s1/151b.jpg</back_img><barcode></barcode></item><item><name>肉マン堕皇帝</name><front_img>barcode/s1/152f.jpg</front_img><back_img>barcode/s1/152b.jpg</back_img><barcode></barcode></item><item><name>邪飢肉エバラキラー</name><front_img>barcode/s1/153f.jpg</front_img><back_img>barcode/s1/153b.jpg</back_img><barcode></barcode></item><item><name>DT鋼化コーラ</name><front_img>barcode/s1/154f.jpg</front_img><back_img>barcode/s1/154b.jpg</back_img><barcode></barcode></item><item><name>ブラックウーロンチャン</name><front_img>barcode/s1/155f.jpg</front_img><back_img>barcode/s1/155b.jpg</back_img><barcode></barcode></item><item><name>メガデスチューハイカーン</name><front_img>barcode/s1/156f.jpg</front_img><back_img>barcode/s1/156b.jpg</back_img><barcode></barcode></item><item><name>Dr.RECYCLE</name><front_img>barcode/s1/157f.jpg</front_img><back_img>barcode/s1/157b.jpg</back_img><barcode></barcode></item></root>",
    "xml/s2.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>超剣士ラーメン活武</name><front_img>barcode/s2/157f.jpg</front_img><back_img>barcode/s2/157b.jpg</back_img><barcode></barcode></item><item><name>超龍ウーロンリー</name><front_img>barcode/s2/158f.jpg</front_img><back_img>barcode/s2/158b.jpg</back_img><barcode></barcode></item><item><name>ガンファイター・マックス</name><front_img>barcode/s2/159f.jpg</front_img><back_img>barcode/s2/159b.jpg</back_img><barcode></barcode></item><item><name>超騎士バーモンドクリフ</name><front_img>barcode/s2/160f.jpg</front_img><back_img>barcode/s2/160b.jpg</back_img><barcode></barcode></item><item><name>超忍中華妖舞</name><front_img>barcode/s2/161f.jpg</front_img><back_img>barcode/s2/161b.jpg</back_img><barcode></barcode></item><item><name>超麗人プリンセスグミー</name><front_img>barcode/s2/162f.jpg</front_img><back_img>barcode/s2/162b.jpg</back_img><barcode></barcode></item><item><name>ノリ千兵衛</name><front_img>barcode/s2/163f.jpg</front_img><back_img>barcode/s2/163b.jpg</back_img><barcode></barcode></item><item><name>ナイトエッセンシャル</name><front_img>barcode/s2/164f.jpg</front_img><back_img>barcode/s2/164b.jpg</back_img><barcode></barcode></item><item><name>出加尾多爺</name><front_img>barcode/s2/165f.jpg</front_img><back_img>barcode/s2/165b.jpg</back_img><barcode></barcode></item><item><name>パンシロンヌ</name><front_img>barcode/s2/166f.jpg</front_img><back_img>barcode/s2/166b.jpg</back_img><barcode></barcode></item><item><name>ストロングバーガー</name><front_img>barcode/s2/167f.jpg</front_img><back_img>barcode/s2/167b.jpg</back_img><barcode></barcode></item><item><name>カンチューハイ</name><front_img>barcode/s2/168f.jpg</front_img><back_img>barcode/s2/168b.jpg</back_img><barcode></barcode></item><item><name>ブルガリアヨグル</name><front_img>barcode/s2/169f.jpg</front_img><back_img>barcode/s2/169b.jpg</back_img><barcode></barcode></item><item><name>ヒュンゲル皇帝神</name><front_img>barcode/s2/170f.jpg</front_img><back_img>barcode/s2/170b.jpg</back_img><barcode></barcode></item><item><name>ホットニードル</name><front_img>barcode/s2/171f.jpg</front_img><back_img>barcode/s2/171b.jpg</back_img><barcode></barcode></item><item><name>プリンス華麗</name><front_img>barcode/s2/172f.jpg</front_img><back_img>barcode/s2/172b.jpg</back_img><barcode></barcode></item><item><name>怨欲獣バフ</name><front_img>barcode/s2/173f.jpg</front_img><back_img>barcode/s2/173b.jpg</back_img><barcode></barcode></item><item><name>幻円将幽</name><front_img>barcode/s2/174f.jpg</front_img><back_img>barcode/s2/174b.jpg</back_img><barcode></barcode></item><item><name>六甲名水</name><front_img>barcode/s2/175f.jpg</front_img><back_img>barcode/s2/175b.jpg</back_img><barcode></barcode></item><item><name>極悪ノーマッド</name><front_img>barcode/s2/176f.jpg</front_img><back_img>barcode/s2/176b.jpg</back_img><barcode></barcode></item><item><name>レジスタンセン</name><front_img>barcode/s2/177f.jpg</front_img><back_img>barcode/s2/177b.jpg</back_img><barcode></barcode></item><item><name>アロンファイター</name><front_img>barcode/s2/178f.jpg</front_img><back_img>barcode/s2/178b.jpg</back_img><barcode></barcode></item><item><name>鬼九正宗</name><front_img>barcode/s2/179f.jpg</front_img><back_img>barcode/s2/179b.jpg</back_img><barcode></barcode></item><item><name>ペプシコーク</name><front_img>barcode/s2/180f.jpg</front_img><back_img>barcode/s2/180b.jpg</back_img><barcode></barcode></item><item><name>新生メガデスチューハイカーン</name><front_img>barcode/s2/181f.jpg</front_img><back_img>barcode/s2/181b.jpg</back_img><barcode></barcode></item><item><name>超龍剣</name><front_img>barcode/s2/182f.jpg</front_img><back_img>barcode/s2/182b.jpg</back_img><barcode></barcode></item><item><name>超甲シールド</name><front_img>barcode/s2/183f.jpg</front_img><back_img>barcode/s2/183b.jpg</back_img><barcode></barcode></item><item><name>ミラクルπウォーター</name><front_img>barcode/s2/184f.jpg</front_img><back_img>barcode/s2/184b.jpg</back_img><barcode></barcode></item><item><name>どくだみ草</name><front_img>barcode/s2/185f.jpg</front_img><back_img>barcode/s2/185b.jpg</back_img><barcode></barcode></item><item><name>魔法のつるぎ</name><front_img>barcode/s2/186f.jpg</front_img><back_img>barcode/s2/186b.jpg</back_img><barcode></barcode></item><item><name>スーパーチューハイカーン</name><front_img>barcode/s2/187f.jpg</front_img><back_img>barcode/s2/187b.jpg</back_img><barcode></barcode></item></root>",
    "xml/s3.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>スーパーチューハイカーン</name><front_img>barcode/s3/187f.jpg</front_img><back_img>barcode/s3/187b.jpg</back_img><barcode></barcode></item><item><name>ウーロンリーＺ</name><front_img>barcode/s3/188f.jpg</front_img><back_img>barcode/s3/188b.jpg</back_img><barcode></barcode></item><item><name>羅王ケイン</name><front_img>barcode/s3/189f.jpg</front_img><back_img>barcode/s3/189b.jpg</back_img><barcode></barcode></item><item><name>中華妖舞Ｒ</name><front_img>barcode/s3/190f.jpg</front_img><back_img>barcode/s3/190b.jpg</back_img><barcode></barcode></item><item><name>百円雷火</name><front_img>barcode/s3/191f.jpg</front_img><back_img>barcode/s3/191b.jpg</back_img><barcode></barcode></item><item><name>ハイライトス･ゴブリン</name><front_img>barcode/s3/192f.jpg</front_img><back_img>barcode/s3/192b.jpg</back_img><barcode></barcode></item><item><name>星雲鬼</name><front_img>barcode/s3/193f.jpg</front_img><back_img>barcode/s3/193b.jpg</back_img><barcode></barcode></item><item><name>レイ･ブロックス</name><front_img>barcode/s3/194f.jpg</front_img><back_img>barcode/s3/194b.jpg</back_img><barcode></barcode></item><item><name>エモリカキャット</name><front_img>barcode/s3/195f.jpg</front_img><back_img>barcode/s3/195b.jpg</back_img><barcode></barcode></item><item><name>スパーク･タウロス</name><front_img>barcode/s3/196f.jpg</front_img><back_img>barcode/s3/196b.jpg</back_img><barcode></barcode></item><item><name>イーペー･チャン</name><front_img>barcode/s3/197f.jpg</front_img><back_img>barcode/s3/197b.jpg</back_img><barcode></barcode></item><item><name>羅烏面</name><front_img>barcode/s3/198f.jpg</front_img><back_img>barcode/s3/198b.jpg</back_img><barcode></barcode></item><item><name>サラスパンダー</name><front_img>barcode/s3/199f.jpg</front_img><back_img>barcode/s3/199b.jpg</back_img><barcode></barcode></item><item><name>悪死ノ市</name><front_img>barcode/s3/200f.jpg</front_img><back_img>barcode/s3/200b.jpg</back_img><barcode></barcode></item><item><name>地上破壊神ゼナ･バスター</name><front_img>barcode/s3/201f.jpg</front_img><back_img>barcode/s3/201b.jpg</back_img><barcode></barcode></item><item><name>飛龍剣</name><front_img>barcode/s3/202f.jpg</front_img><back_img>barcode/s3/202b.jpg</back_img><barcode>0001800531138</barcode></item><item><name>グレートアックス</name><front_img>barcode/s3/203f.jpg</front_img><back_img>barcode/s3/203b.jpg</back_img><barcode>2092208565014</barcode></item><item><name>ネプチューンメイル</name><front_img>barcode/s3/204f.jpg</front_img><back_img>barcode/s3/204b.jpg</back_img><barcode>2090320705042</barcode></item><item><name>サイコヘッド</name><front_img>barcode/s3/205f.jpg</front_img><back_img>barcode/s3/205b.jpg</back_img><barcode>0000014705250</barcode></item><item><name>ポケットライス</name><front_img>barcode/s3/206f.jpg</front_img><back_img>barcode/s3/206b.jpg</back_img><barcode>0300000907157</barcode></item><item><name>カロリーＭＴ</name><front_img>barcode/s3/207f.jpg</front_img><back_img>barcode/s3/207b.jpg</back_img><barcode>0500000905300</barcode></item><item><name>魔法のティアラ</name><front_img>barcode/s3/208f.jpg</front_img><back_img>barcode/s3/208b.jpg</back_img><barcode>0000010990209</barcode></item><item><name>魔法の教典</name><front_img>barcode/s3/209f.jpg</front_img><back_img>barcode/s3/209b.jpg</back_img><barcode>0000010980057</barcode></item><item><name>またたびの実</name><front_img>barcode/s3/210f.jpg</front_img><back_img>barcode/s3/210b.jpg</back_img><barcode>0000600970062</barcode></item><item><name>凍結酒</name><front_img>barcode/s3/211f.jpg</front_img><back_img>barcode/s3/211b.jpg</back_img><barcode>0000100970449</barcode></item></root>",
    "xml/s4.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>超チューハイカーン</name><front_img>barcode/s4/212f.jpg</front_img><back_img>barcode/s4/212b.jpg</back_img><barcode></barcode></item><item><name>ウーロンリーＺ</name><front_img>barcode/s4/213f.jpg</front_img><back_img>barcode/s4/213b.jpg</back_img><barcode></barcode></item><item><name>羅王ケイン</name><front_img>barcode/s4/214f.jpg</front_img><back_img>barcode/s4/214b.jpg</back_img><barcode></barcode></item><item><name>中華妖舞Ｒ</name><front_img>barcode/s4/215f.jpg</front_img><back_img>barcode/s4/215b.jpg</back_img><barcode></barcode></item><item><name>木の精霊ソルト</name><front_img>barcode/s4/216f.jpg</front_img><back_img>barcode/s4/216b.jpg</back_img><barcode></barcode></item><item><name>風の精霊チャバ</name><front_img>barcode/s4/217f.jpg</front_img><back_img>barcode/s4/217b.jpg</back_img><barcode></barcode></item><item><name>光の精霊ライム</name><front_img>barcode/s4/218f.jpg</front_img><back_img>barcode/s4/218b.jpg</back_img><barcode></barcode></item><item><name>雷の精霊スパーク</name><front_img>barcode/s4/219f.jpg</front_img><back_img>barcode/s4/219b.jpg</back_img><barcode></barcode></item><item><name>水の精霊イオン</name><front_img>barcode/s4/220f.jpg</front_img><back_img>barcode/s4/220b.jpg</back_img><barcode></barcode></item><item><name>炎の精霊ジュッポ</name><front_img>barcode/s4/221f.jpg</front_img><back_img>barcode/s4/221b.jpg</back_img><barcode></barcode></item><item><name>土の精霊コーン</name><front_img>barcode/s4/222f.jpg</front_img><back_img>barcode/s4/222b.jpg</back_img><barcode></barcode></item><item><name>ピザパイヤ</name><front_img>barcode/s4/223f.jpg</front_img><back_img>barcode/s4/223b.jpg</back_img><barcode></barcode></item><item><name>ラーマラージャ</name><front_img>barcode/s4/224f.jpg</front_img><back_img>barcode/s4/224b.jpg</back_img><barcode></barcode></item><item><name>破留魔鬼</name><front_img>barcode/s4/225f.jpg</front_img><back_img>barcode/s4/225b.jpg</back_img><barcode></barcode></item><item><name>露本人麿</name><front_img>barcode/s4/226f.jpg</front_img><back_img>barcode/s4/226b.jpg</back_img><barcode></barcode></item><item><name>モンプッチーニ</name><front_img>barcode/s4/227f.jpg</front_img><back_img>barcode/s4/227b.jpg</back_img><barcode></barcode></item><item><name>ジプロシュタイン</name><front_img>barcode/s4/228f.jpg</front_img><back_img>barcode/s4/228b.jpg</back_img><barcode></barcode></item><item><name>メー･グイ･ファン</name><front_img>barcode/s4/229f.jpg</front_img><back_img>barcode/s4/229b.jpg</back_img><barcode></barcode></item><item><name>ノンスメル･スカル</name><front_img>barcode/s4/230f.jpg</front_img><back_img>barcode/s4/230b.jpg</back_img><barcode></barcode></item><item><name>マッドチップス</name><front_img>barcode/s4/231f.jpg</front_img><back_img>barcode/s4/231b.jpg</back_img><barcode></barcode></item><item><name>ＴＢノワ</name><front_img>barcode/s4/232f.jpg</front_img><back_img>barcode/s4/232b.jpg</back_img><barcode></barcode></item><item><name>スピンピオン</name><front_img>barcode/s4/233f.jpg</front_img><back_img>barcode/s4/233b.jpg</back_img><barcode></barcode></item><item><name>オレオフライ</name><front_img>barcode/s4/234f.jpg</front_img><back_img>barcode/s4/234b.jpg</back_img><barcode></barcode></item><item><name>死不奴</name><front_img>barcode/s4/235f.jpg</front_img><back_img>barcode/s4/235b.jpg</back_img><barcode></barcode></item><item><name>玉音妓</name><front_img>barcode/s4/236f.jpg</front_img><back_img>barcode/s4/236b.jpg</back_img><barcode></barcode></item><item><name>陰土</name><front_img>barcode/s4/237f.jpg</front_img><back_img>barcode/s4/237b.jpg</back_img><barcode></barcode></item><item><name>地中破壊神ゼナ･マグマ</name><front_img>barcode/s4/238f.jpg</front_img><back_img>barcode/s4/238b.jpg</back_img><barcode></barcode></item><item><name>温泉たまご</name><front_img>barcode/s4/239f.jpg</front_img><back_img>barcode/s4/239b.jpg</back_img><barcode></barcode></item><item><name>解毒草</name><front_img>barcode/s4/240f.jpg</front_img><back_img>barcode/s4/240b.jpg</back_img><barcode></barcode></item><item><name>魔法の首飾り</name><front_img>barcode/s4/241f.jpg</front_img><back_img>barcode/s4/241b.jpg</back_img><barcode></barcode></item><item><name>ラーメン活武</name><front_img>barcode/s4/242f.jpg</front_img><back_img>barcode/s4/242b.jpg</back_img><barcode></barcode></item></root>",
    "xml/smw.xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?><root><item><name>マリオ</name><front_img>barcode/smw/1f.jpg</front_img><back_img>barcode/smw/1b.jpg</back_img><barcode></barcode></item><item><name>ルイージ</name><front_img>barcode/smw/2f.jpg</front_img><back_img>barcode/smw/2b.jpg</back_img><barcode></barcode></item><item><name>ヨッシー</name><front_img>barcode/smw/3f.jpg</front_img><back_img>barcode/smw/3b.jpg</back_img><barcode></barcode></item><item><name>チビヨッシー</name><front_img>barcode/smw/4f.jpg</front_img><back_img>barcode/smw/4b.jpg</back_img><barcode></barcode></item><item><name>マント羽根</name><front_img>barcode/smw/5f.jpg</front_img><back_img>barcode/smw/5b.jpg</back_img><barcode></barcode></item><item><name>ファイアーフラワー</name><front_img>barcode/smw/6f.jpg</front_img><back_img>barcode/smw/6b.jpg</back_img><barcode></barcode></item><item><name>ボディプレス</name><front_img>barcode/smw/7f.jpg</front_img><back_img>barcode/smw/7b.jpg</back_img><barcode></barcode></item><item><name>ジャンプ</name><front_img>barcode/smw/8f.jpg</front_img><back_img>barcode/smw/8b.jpg</back_img><barcode></barcode></item><item><name>スーパースター</name><front_img>barcode/smw/9f.jpg</front_img><back_img>barcode/smw/9b.jpg</back_img><barcode></barcode></item><item><name>スーパーキノコ</name><front_img>barcode/smw/10f.jpg</front_img><back_img>barcode/smw/10b.jpg</back_img><barcode></barcode></item><item><name>ノコノコの甲羅</name><front_img>barcode/smw/11f.jpg</front_img><back_img>barcode/smw/11b.jpg</back_img><barcode></barcode></item><item><name>１ＵＰキノコ</name><front_img>barcode/smw/12f.jpg</front_img><back_img>barcode/smw/12b.jpg</back_img><barcode></barcode></item><item><name>パタパタ</name><front_img>barcode/smw/13f.jpg</front_img><back_img>barcode/smw/13b.jpg</back_img><barcode></barcode></item><item><name>ピーパックン</name><front_img>barcode/smw/14f.jpg</front_img><back_img>barcode/smw/14b.jpg</back_img><barcode></barcode></item><item><name>マントガメ</name><front_img>barcode/smw/15f.jpg</front_img><back_img>barcode/smw/15b.jpg</back_img><barcode></barcode></item><item><name>チョロプー</name><front_img>barcode/smw/16f.jpg</front_img><back_img>barcode/smw/16b.jpg</back_img><barcode></barcode></item><item><name>トゲゾー</name><front_img>barcode/smw/17f.jpg</front_img><back_img>barcode/smw/17b.jpg</back_img><barcode></barcode></item><item><name>グースカ</name><front_img>barcode/smw/18f.jpg</front_img><back_img>barcode/smw/18b.jpg</back_img><barcode></barcode></item><item><name>ジュゲム</name><front_img>barcode/smw/19f.jpg</front_img><back_img>barcode/smw/19b.jpg</back_img><barcode></barcode></item><item><name>ハナチャン</name><front_img>barcode/smw/20f.jpg</front_img><back_img>barcode/smw/20b.jpg</back_img><barcode></barcode></item><item><name>ブイブイ</name><front_img>barcode/smw/21f.jpg</front_img><back_img>barcode/smw/21b.jpg</back_img><barcode></barcode></item><item><name>ブル</name><front_img>barcode/smw/22f.jpg</front_img><back_img>barcode/smw/22b.jpg</back_img><barcode></barcode></item><item><name>テレサウルス</name><front_img>barcode/smw/23f.jpg</front_img><back_img>barcode/smw/23b.jpg</back_img><barcode></barcode></item><item><name>ウンババ</name><front_img>barcode/smw/24f.jpg</front_img><back_img>barcode/smw/24b.jpg</back_img><barcode></barcode></item><item><name>マグナムキラー</name><front_img>barcode/smw/25f.jpg</front_img><back_img>barcode/smw/25b.jpg</back_img><barcode></barcode></item><item><name>カメック</name><front_img>barcode/smw/26f.jpg</front_img><back_img>barcode/smw/26b.jpg</back_img><barcode></barcode></item><item><name>メカクッパ</name><front_img>barcode/smw/27f.jpg</front_img><back_img>barcode/smw/27b.jpg</back_img><barcode></barcode></item><item><name>ラリー</name><front_img>barcode/smw/28f.jpg</front_img><back_img>barcode/smw/28b.jpg</back_img><barcode>1002325114812</barcode></item><item><name>ルドウィッグ</name><front_img>barcode/smw/29f.jpg</front_img><back_img>barcode/smw/29b.jpg</back_img><barcode></barcode></item><item><name>クッパ</name><front_img>barcode/smw/30f.jpg</front_img><back_img>barcode/smw/30b.jpg</back_img><barcode></barcode></item></root>"
  };

  function loadXmlText(relPath, onDone) {
    /* file:// 直開き環境の場合、ブラウザの CORS 制限によるエラーを防ぐため即座に内蔵 XML を使用 */
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      onDone(FALLBACK_XML[relPath] || '');
      return;
    }
    var assetUrl = 'assets/' + relPath;
    if (typeof fetch === 'function' && typeof location !== 'undefined' && /^https?:$/i.test(location.protocol)) {
      fetch(assetUrl).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }).then(function (txt) {
        onDone(txt);
      }).catch(function () {
        onDone(FALLBACK_XML[relPath] || '');
      });
      return;
    }
    if (typeof XMLHttpRequest !== 'undefined') {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', assetUrl, true);
        xhr.onload = function () {
          if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) {
            onDone(xhr.responseText);
          } else {
            onDone(FALLBACK_XML[relPath] || '');
          }
        };
        xhr.onerror = function () {
          onDone(FALLBACK_XML[relPath] || '');
        };
        xhr.send();
        return;
      } catch (e) {}
    }
    onDone(FALLBACK_XML[relPath] || '');
  }

  /* barcode_cards.as 24-115 の UI 接続 */
  function initBrowser(view) {
    if (typeof document === 'undefined') return;
    var listTable = document.getElementById('card_list_datagrid');
    var nameTable = document.getElementById('card_name_datagrid');
    var cardImage = document.getElementById('card_image');
    if (!listTable || !nameTable || !cardImage) return;

    var BLANK_CARD_IMAGE = 'assets/barcode/bb2/blank.jpg';

    /* 画像読み込みエラー(404・リンク切れ等)時の blank.jpg フォールバック */
    cardImage.addEventListener('error', function () {
      if (this.src && this.src.indexOf('blank.jpg') === -1) {
        this.src = BLANK_CARD_IMAGE;
      }
    });

    var listTbody = listTable.querySelector('tbody') || listTable.appendChild(document.createElement('tbody'));
    var nameTbody = nameTable.querySelector('tbody') || nameTable.appendChild(document.createElement('tbody'));

    var state = {
      listItems: [],
      cardItems: [],
      selectedListItem: null,
      selectedCardItem: null,
      selectedCardBarcode: '',
      frontBack: true /* 60: true:表 false:裏 */
    };

    /* 入力欄(card_in)のバーコード数値と選択中カードのバーコードが一致するか検証し画像を同期 */
    function syncCardImageWithInput() {
      if (!cardImage) return;
      var cardInVal = (view && view.el && view.el.card_in) ? String(view.el.card_in.value || '').trim() : '';
      var item = state.selectedCardItem;
      var expectedCode = (state.selectedCardBarcode != null ? String(state.selectedCardBarcode) : '').trim();

      var match = false;
      if (item && cardInVal && expectedCode) {
        match = (cardInVal === expectedCode) || (padBarcode13(cardInVal) === padBarcode13(expectedCode));
      }

      // 入力欄の数値が異なる場合、またはカード未選択の場合は blank.jpg を表示
      if (!match || !item) {
        cardImage.src = BLANK_CARD_IMAGE;
        return;
      }

      var targetImg = state.frontBack ? item.front_img : item.back_img;
      cardImage.src = targetImg ? ('assets/' + targetImg) : BLANK_CARD_IMAGE;
    }

    state.syncCardImageWithInput = syncCardImageWithInput;

    /* 107-115: change_front_back_image (表裏切替) */
    cardImage.addEventListener('click', function () {
      if (!state.selectedCardItem) return;
      state.frontBack = !state.frontBack;
      syncCardImageWithInput();
    });

    /* 入力欄の編集監視: 手動入力や変更で数値が変わったら即座に blank.jpg と同期 */
    if (view && view.el && view.el.card_in) {
      view.el.card_in.addEventListener('input', syncCardImageWithInput);
      view.el.card_in.addEventListener('change', syncCardImageWithInput);
    }

    /* 64-85: barcode_cards_load + barcode_cards_load_done */
    function onSelectCard(item, tr) {
      state.selectedCardItem = item;
      state.frontBack = true;
      state.selectedCardBarcode = String(item.barcode || '');
      Array.prototype.forEach.call(nameTbody.querySelectorAll('tr'), function (r) {
        r.classList.toggle('selected', r === tr);
      });
      if (item.barcode && view && view.el && view.el.card_in) {
        view.el.card_in.value = String(item.barcode);
      }
      syncCardImageWithInput();

      /* 裏面画像を読み込んで clip(0,178,330,50) → analyze_barcode_data、失敗または画像不在時は item.barcode フォールバック */
      if (item.back_img && typeof Image !== 'undefined') {
        var backLoader = new Image();
        backLoader.onload = function () {
          var clipped = clipImageToData(backLoader, 0, 178, 330, 50);
          analyzeBarcodeData(clipped, item.barcode, function (code) {
            state.selectedCardBarcode = code || String(item.barcode || '');
            if (view && view.el && view.el.card_in) {
              view.el.card_in.value = code;
            }
            syncCardImageWithInput();
            if (view && typeof view.note === 'function') {
              view.note('カード選択: ' + item.name + (code ? ' (barcode=' + code + ')' : ''));
            }
          });
        };
        backLoader.onerror = function () {
          var fallback = String(item.barcode || '');
          state.selectedCardBarcode = fallback;
          if (view && view.el && view.el.card_in) {
            view.el.card_in.value = fallback;
          }
          syncCardImageWithInput();
          if (view && typeof view.note === 'function') {
            view.note('カード選択: ' + item.name + (fallback ? ' (barcode=' + fallback + ')' : ''));
          }
        };
        backLoader.src = 'assets/' + item.back_img;
      } else {
        var code = String(item.barcode || '');
        state.selectedCardBarcode = code;
        if (view && view.el && view.el.card_in) {
          view.el.card_in.value = code;
        }
        syncCardImageWithInput();
      }
    }

    /* 42-45: name_load_complete */
    function renderCardList(items) {
      state.cardItems = items;
      nameTbody.innerHTML = '';
      items.forEach(function (item) {
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.textContent = item.name;
        tr.appendChild(td);
        tr.addEventListener('click', function () {
          onSelectCard(item, tr);
        });
        nameTbody.appendChild(tr);
      });
    }

    /* 49-55: barcode_list_load */
    function onSelectSeries(item, tr) {
      state.selectedListItem = item;
      Array.prototype.forEach.call(listTbody.querySelectorAll('tr'), function (r) {
        r.classList.toggle('selected', r === tr);
      });
      if (!item || !item.xml) return;
      loadXmlText('xml/' + item.xml, function (xmlText) {
        renderCardList(parseCardsXml(xmlText));
      });
    }

    /* 36-39: list_load_complete */
    function renderSeriesList(items) {
      state.listItems = items;
      listTbody.innerHTML = '';
      items.forEach(function (item, idx) {
        var tr = document.createElement('tr');
        if (idx === 0) tr.classList.add('selected');
        var td = document.createElement('td');
        td.textContent = item.name;
        tr.appendChild(td);
        tr.addEventListener('click', function () {
          onSelectSeries(item, tr);
        });
        listTbody.appendChild(tr);
      });
    }

    /* 25-28: 初期リスト(xml/list.xml)・初期カードリスト(xml/bb2.xml)読み込み */
    loadXmlText('xml/list.xml', function (xmlText) {
      renderSeriesList(parseListXml(xmlText));
    });
    loadXmlText('xml/bb2.xml', function (xmlText) {
      renderCardList(parseCardsXml(xmlText));
    });

    /* --- CATEGORY と CARDS 間のドラッグリサイズ初期化 --- */
    (function initCardListResizer() {
      var resizer = document.getElementById('card_list_resizer');
      var categoryScroll = document.querySelector('.card-category-scroll');
      if (!resizer || !categoryScroll) return;

      /* 保存された高さがあれば復元 */
      try {
        var savedHeight = localStorage.getItem('bb2_category_scroll_height');
        if (savedHeight) {
          var h = parseInt(savedHeight, 10);
          if (!isNaN(h) && h >= 45 && h <= 360) {
            categoryScroll.style.height = h + 'px';
          }
        }
      } catch (e) {}

      var startY = 0;
      var startHeight = 0;
      var isDragging = false;

      function onPointerMove(ev) {
        if (!isDragging) return;
        var deltaY = ev.clientY - startY;
        var newHeight = Math.round(startHeight + deltaY);
        if (newHeight < 45) newHeight = 45;
        if (newHeight > 360) newHeight = 360;
        categoryScroll.style.height = newHeight + 'px';
      }

      function onPointerUp(ev) {
        if (!isDragging) return;
        isDragging = false;
        try {
          resizer.releasePointerCapture(ev.pointerId);
        } catch (e) {}
        resizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        try {
          var finalH = parseInt(categoryScroll.style.height, 10);
          if (!isNaN(finalH)) {
            localStorage.setItem('bb2_category_scroll_height', String(finalH));
          }
        } catch (e) {}
      }

      resizer.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        isDragging = true;
        startY = ev.clientY;
        startHeight = categoryScroll.getBoundingClientRect().height;
        try {
          resizer.setPointerCapture(ev.pointerId);
        } catch (e) {}
        resizer.classList.add('is-dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
      });
    })();

    view.cardBrowser = state;
  }

  BB2.Cards = {
    FALLBACK_XML: FALLBACK_XML,
    parseListXml: parseListXml,
    parseCardsXml: parseCardsXml,
    padBarcode13: padBarcode13,
    verifyEanChecksum: verifyEanChecksum,
    decodeEanFromImageData: decodeEanFromImageData,
    analyzeBarcodeData: analyzeBarcodeData,
    initBrowser: initBrowser
  };
})(typeof window !== 'undefined' ? window : globalThis);
