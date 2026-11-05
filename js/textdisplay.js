/* textdisplay.js — TextInputSprite.as(364 行・元 src は無変更)の移植
   2026-11-04 作業6 工程2。7 セグ風 PNG 合成(design §8 の未確定事項が TextInputSprite.as 実測で確定):
     - disp_val(172-194): String は space を末尾に継ぎ 5 文字・数値は abs+「00」付与後
       space を先頭に詰めて右詰め 5 文字(195→"19500"・0→"   00"・-3→"  300"・
       199→"19900" — 351 行コメント「stdf:STかDFの場合は19900以上を19900と表示する」仕様)
     - display_str(201-325): 1 列 25×40 の bb2digits/*.png を列位置(i*25)に描画・
       文字は小文字化して照合・マッピング外文字は copyPixels 実行されず前の描画内容が残る
       (JS も該当セルの img を更新しないことで同じ挙動にする)
     - pp_text(327-341)/mp_text(343-349): 数値は value<10 なら space2・以上なら space1 個先頭に
       付与し String 化 → disp_val は String 扱い(space 末尾継ぎ)
   マッピング 28 項目は assets/bb2digits の 28 ファイル(数字 10+英文字 15+「-」「=」「space」)の全写し。
   元 BitmapData(125×40) = 5 列合成。JS では各ディスプレイに 25×40 の <img> 5 列を保持し、
   setText ごとに既知文字の列だけ src を書き換える(未知文字の列は前の内容保持)。 */
(function (global) {
  'use strict';

  function cellsFor(el) {                    /* 5 列の img を作り要素に保持(initialize 相当 167-169) */
    if (el._bb2Cells) { return el._bb2Cells; }
    el.textContent = '';                     /* プレースホルダ text ノードを消して合成専用にする */
    var cells = [];
    for (var i = 0; i < Digits.MAX_COL; i++) {
      var img = document.createElement('img');
      img.className = 'bb2-cell';
      img.width = 25; img.height = 40;       /* Rectangle(0,0,25,40)(203 行)相当 */
      img.alt = '';
      el.appendChild(img);
      cells.push(img);
    }
    el._bb2Cells = cells;
    return cells;
  }

  var Digits = {
    MAX_COL: 5,                              /* 元 bitmap 125 幅=5 列。6 列目以降はコピー対象外(JS では打ち切り) */

    CHAR_SRC: {                              /* Embed 21-158 行 + display_str switch 210-323 行の対応 */
      '-': 'assets/bb2digits/-.png',
      '=': 'assets/bb2digits/=.png',
      '0': 'assets/bb2digits/0.png',
      '1': 'assets/bb2digits/1.png',
      '2': 'assets/bb2digits/2.png',
      '3': 'assets/bb2digits/3.png',
      '4': 'assets/bb2digits/4.png',
      '5': 'assets/bb2digits/5.png',
      '6': 'assets/bb2digits/6.png',
      '7': 'assets/bb2digits/7.png',
      '8': 'assets/bb2digits/8.png',
      '9': 'assets/bb2digits/9.png',
      'a': 'assets/bb2digits/a.png',
      'c': 'assets/bb2digits/c.png',
      'd': 'assets/bb2digits/d.png',
      'e': 'assets/bb2digits/e.png',
      'f': 'assets/bb2digits/f.png',
      'g': 'assets/bb2digits/g.png',
      'h': 'assets/bb2digits/h.png',
      'i': 'assets/bb2digits/i.png',
      'l': 'assets/bb2digits/l.png',
      'n': 'assets/bb2digits/n.png',
      'o': 'assets/bb2digits/o.png',
      'p': 'assets/bb2digits/p.png',
      'q': 'assets/bb2digits/q.png',
      's': 'assets/bb2digits/s.png',
      'v': 'assets/bb2digits/v.png',
      ' ': 'assets/bb2digits/space.png'
    },

    dispVal: function (value) {              /* disp_val(172-194)相当 */
      var value_str;
      if (typeof value === 'string') {       /* value is String(173-177): 末尾 space 継ぎ */
        value_str = value;
        while (value_str.length < 5) { value_str = value_str + ' '; }
        return value_str;
      }
      var num = Number(value);               /* value as int(179)相当: NaN は 0 として扱う */
      if (!isFinite(num)) { num = 0; }
      num = Math.trunc(num);
      if (num !== 0) {
        if (num < 0) { num = 0 - num; }      /* num<0 → abs(181-183)相当・数値に負記号は出さない */
        value_str = num.toString() + '00';   /* 「00」付与(184)相当 — 固定小数点表記相当 */
      } else {
        value_str = '00';                    /* num==0 → "00"(186)相当 */
      }
      while (value_str.length < 5) { value_str = ' ' + value_str; }  /* 先頭 space 詰め(189-191) */
      return value_str;
    },

    charSrc: function (ch) {                 /* display_str(209-210)相当: 小文字化・未知は null(=セル保持) */
      var lower = ch.toLowerCase();
      return Object.prototype.hasOwnProperty.call(Digits.CHAR_SRC, lower) ? Digits.CHAR_SRC[lower] : null;
    },

    ppPad: function (value) {                /* pp_text 前付部(333-336)相当・テスト検証用に公開 */
      return (value < 10) ? '  ' + value : ' ' + value;
    },

    setText: function (el, value) {          /* text setter(352-359)相当 */
      var str = Digits.dispVal(value);
      var cells = cellsFor(el);
      for (var i = 0; i < str.length && i < Digits.MAX_COL; i++) {
        var src = Digits.charSrc(str.charAt(i));
        if (src) { cells[i].src = src; }     /* 未知文字は元 copyPixels 非実行=前の描画内容保持(JS も無操作) */
      }
    },

    setPpText: function (el, value) {        /* pp_text setter(331-341)相当(String 化後 String 分支 space 継ぎ) */
      Digits.setText(el, Digits.ppPad(value));
    },

    setMpText: function (el, value) { Digits.setPpText(el, value); }  /* mp_text(347-348)相当 */
  };

  var BB2 = global.BB2 = global.BB2 || {};
  BB2.Digits = Digits;
})(typeof window !== 'undefined' ? window : this);
