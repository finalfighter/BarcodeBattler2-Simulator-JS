/* preload.js — Web公開用アセット事前読み込み(bb2digits / bb2graphics / img / se)
 * 73ファイル (合計約 1.33 MB) をバックグラウンドで先読みし、ブラウザキャッシュおよび
 * Audio プール(sePool)へ事前展開して、7セグ表示のちらつき防止・SE再生の遅延ゼロを実現する。
 */
(function (global) {
  'use strict';

  var BB2 = global.BB2 = global.BB2 || {};

  var MANIFEST = {
    bb2digits: [
      'assets/bb2digits/-.png',
      'assets/bb2digits/0.png',
      'assets/bb2digits/1.png',
      'assets/bb2digits/2.png',
      'assets/bb2digits/3.png',
      'assets/bb2digits/4.png',
      'assets/bb2digits/5.png',
      'assets/bb2digits/6.png',
      'assets/bb2digits/7.png',
      'assets/bb2digits/8.png',
      'assets/bb2digits/9.png',
      'assets/bb2digits/=.png',
      'assets/bb2digits/a.png',
      'assets/bb2digits/c.png',
      'assets/bb2digits/d.png',
      'assets/bb2digits/e.png',
      'assets/bb2digits/f.png',
      'assets/bb2digits/g.png',
      'assets/bb2digits/h.png',
      'assets/bb2digits/i.png',
      'assets/bb2digits/l.png',
      'assets/bb2digits/n.png',
      'assets/bb2digits/o.png',
      'assets/bb2digits/p.png',
      'assets/bb2digits/q.png',
      'assets/bb2digits/s.png',
      'assets/bb2digits/space.png',
      'assets/bb2digits/v.png'
    ],
    bb2graphics: [
      'assets/bb2graphics/bb2body.png',
      'assets/bb2graphics/light.png',
      'assets/bb2graphics/l_battle.png',
      'assets/bb2graphics/l_power.png',
      'assets/bb2graphics/on.png',
      'assets/bb2graphics/r_battle.png',
      'assets/bb2graphics/r_power.png',
      'assets/bb2graphics/select.png',
      'assets/bb2graphics/set.png',
      'assets/bb2graphics/sound_off.png',
      'assets/bb2graphics/sound_on.png'
    ],
    img: [
      'assets/img/battle.png',
      'assets/img/bb2back.jpg',
      'assets/img/card_input.png',
      'assets/img/critical.png',
      'assets/img/damage.png',
      'assets/img/df.png',
      'assets/img/escape.png',
      'assets/img/hp.png',
      'assets/img/infomation.png',
      'assets/img/item.png',
      'assets/img/key.png',
      'assets/img/magician.png',
      'assets/img/miss.png',
      'assets/img/mp.png',
      'assets/img/power.png',
      'assets/img/pp.png',
      'assets/img/st.png',
      'assets/img/warrior.png'
    ],
    se: [
      'assets/se/battle.mp3',
      'assets/se/battle_critical.mp3',
      'assets/se/battle_end.mp3',
      'assets/se/battle_end_c2.mp3',
      'assets/se/battle_miss.mp3',
      'assets/se/card_in_error.mp3',
      'assets/se/card_in_power.mp3',
      'assets/se/change.mp3',
      'assets/se/critical.mp3',
      'assets/se/decide.mp3',
      'assets/se/decide_first_player.mp3',
      'assets/se/miss.mp3',
      'assets/se/on.mp3',
      'assets/se/passcode.mp3',
      'assets/se/select.mp3',
      'assets/se/status_down.mp3'
    ],
    barcode: [
      'assets/barcode/bb2/blank.jpg'
    ]
  };

  /* SE ファイル名と SE_SRC キーの対応表 */
  var SE_KEY_MAP = {
    'battle.mp3': 'battle_mp3',
    'battle_critical.mp3': 'battle_critical_mp3',
    'battle_end.mp3': 'battle_end_mp3',
    'battle_end_c2.mp3': 'battle_end_c2_mp3',
    'battle_miss.mp3': 'battle_miss_mp3',
    'card_in_error.mp3': 'card_in_error_mp3',
    'card_in_power.mp3': 'card_in_mp3',
    'change.mp3': 'change_mp3',
    'critical.mp3': 'critical_mp3',
    'decide.mp3': 'decide_mp3',
    'decide_first_player.mp3': 'decide_first_player_mp3',
    'miss.mp3': 'miss_mp3',
    'on.mp3': 'on_mp3',
    'passcode.mp3': 'passcode_mp3',
    'select.mp3': 'select_mp3',
    'status_down.mp3': 'status_down_mp3'
  };

  var Preloader = {
    MANIFEST: MANIFEST,
    imageCache: [],
    loadedCount: 0,
    totalCount: 0,
    isDone: false,

    start: function (view, onComplete) {
      if (typeof window === 'undefined') return;

      var images = [].concat(MANIFEST.bb2digits, MANIFEST.bb2graphics, MANIFEST.img, MANIFEST.barcode);
      var audios = MANIFEST.se;
      this.totalCount = images.length + audios.length;
      this.loadedCount = 0;
      var self = this;

      function checkDone() {
        self.loadedCount++;
        if (self.loadedCount >= self.totalCount) {
          self.isDone = true;
          console.info('[BB2] Preloaded ' + self.totalCount + ' assets (bb2digits/bb2graphics/img/se)');
          if (typeof onComplete === 'function') onComplete();
        }
      }

      /* 画像先読み (Image オブジェクトを配列に保持して GC を防ぐ) */
      if (typeof Image !== 'undefined') {
        for (var i = 0; i < images.length; i++) {
          (function (src) {
            var img = new Image();
            img.onload = checkDone;
            img.onerror = checkDone;
            img.src = src;
            self.imageCache.push(img);
          })(images[i]);
        }
      } else {
        self.loadedCount += images.length;
      }

      /* SE 先読み (view.sePool へ事前格納) */
      if (typeof Audio !== 'undefined') {
        var pool = (view && view.sePool) ? view.sePool : (view ? (view.sePool = {}) : {});
        for (var j = 0; j < audios.length; j++) {
          (function (src) {
            var filename = src.split('/').pop();
            var seKey = SE_KEY_MAP[filename];
            var a = new Audio();
            a.preload = 'auto';
            a.src = src;
            if (seKey && pool) {
              pool[seKey] = a;
              if (seKey === 'card_in_mp3' && !pool.power_mp3) {
                pool.power_mp3 = a; /* card_in_power.mp3 は power_mp3 と同一ファイル */
              }
            }
            var doneOnce = false;
            var onAudioReady = function () {
              if (doneOnce) return;
              doneOnce = true;
              a.removeEventListener('canplaythrough', onAudioReady);
              a.removeEventListener('error', onAudioReady);
              checkDone();
            };
            a.addEventListener('canplaythrough', onAudioReady, { once: true });
            a.addEventListener('error', onAudioReady, { once: true });
            setTimeout(onAudioReady, 2500);
          })(audios[j]);
        }
      } else {
        self.loadedCount += audios.length;
      }
    }
  };

  BB2.Preloader = Preloader;
})(typeof window !== 'undefined' ? window : this);
