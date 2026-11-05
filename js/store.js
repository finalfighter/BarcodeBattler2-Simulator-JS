/* store.js — 保存層(design §4.1 準拠: SharedObject("bb2_simulator") → localStorage 単一キー集約)
 *
 * キー "bb2_simulator" に {version, settings, save} を集約(design §4.1 の方針どおり)。
 * settings: scale / sound_mute / auto_input(実測 5 キーのうち設定 3 キーを対応)
 * save: ゲームセーブ(c1_world_data / barcode_data_c1 相当)を Phase 6 で実装
 *       (registerClassAlias 相当の type: "C1WorldData"|"BarcodeData" タグ付き多相直列化・復元)。
 * 元 Flash の .sol(AMF3)との互換引き継ぎは未確定(design §8)につき未実装。
 */
(function (global) {
  'use strict';

  var BB2 = global.BB2 = global.BB2 || {};

  var KEY = 'bb2_simulator';
  var DEFAULTS = {
    version: 1,
    settings: {
      scale: 1,
      sound_mute: false,
      auto_input: false,
      show_debug: false,          /* デバッグ情報バー表示設定(既定値: false) */
      cards_collapsed: false,     /* カード一覧折りたたみ設定(既定値: false) */
      card_animation: true        /* 3Dカード通過アニメーション設定(既定値: true) */
    },
    save: null   /* Phase 6: { c1_world_data: {type:"C1WorldData",...}, barcode_data_c1: [{type:"BarcodeData",...}|null] } */
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function serializeWorldData(w) {
    if (!w) return null;
    var out = { type: 'C1WorldData' };
    var keys = [
      'unioncheckdigit', 'default_stage', 'stage', 'select_stage',
      'default_world', 'world', 'select_world', 'default_passcode_number',
      'default_enemy', 'enemy', 'select_enemy', 'default_key', 'key',
      'default_race_list', 'default_job_list', 'default_enemy_paramater',
      'infomation_flag_a', 'infomation_flag_b'
    ];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (w[k] !== undefined) out[k] = clone(w[k]);
    }
    return out;
  }

  function deserializeWorldData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var w = BB2.C1WorldData ? new BB2.C1WorldData() : {};
    for (var k in raw) {
      if (k !== 'type' && Object.prototype.hasOwnProperty.call(raw, k)) {
        w[k] = clone(raw[k]);
      }
    }
    return w;
  }

  function serializeBarcodeData(bd) {
    if (!bd) return null;
    var out = { type: 'BarcodeData' };
    var keys = ['live', 'barcode', 'hp', 'max_hp', 'st', 'df', 'speed', 'race', 'job', 'special', 'mp', 'pp'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (bd[k] !== undefined) out[k] = bd[k];
    }
    return out;
  }

  function deserializeBarcodeData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var bd = BB2.BarcodeData ? new BB2.BarcodeData() : {};
    for (var k in raw) {
      if (k !== 'type' && Object.prototype.hasOwnProperty.call(raw, k)) {
        bd[k] = raw[k];
      }
    }
    return bd;
  }

  var Store = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,

    /* 読み込み: 未取得/破損時は DEFAULTS とマージして返す(起動時の安全な初期値) */
    load: function () {
      var merged = clone(DEFAULTS);
      var raw = null;
      try { raw = global.localStorage ? global.localStorage.getItem(KEY) : null; } catch (e) { /* storage 不可: 既定値のまま */ }
      if (raw) {
        var data = null;
        try { data = JSON.parse(raw); } catch (e) { data = null; }
        if (data && typeof data === 'object') {
          if (data.version) merged.version = data.version;
          if (data.settings && typeof data.settings === 'object') {
            for (var k in DEFAULTS.settings) {
              if (Object.prototype.hasOwnProperty.call(data.settings, k)) merged.settings[k] = data.settings[k];
            }
          }
          if ('save' in data) merged.save = data.save;
        }
      }
      return merged;
    },

    /* 保存(設定・データ全体)。戻り値: 成功 true / localStorage 不可等は false */
    saveSettings: function (data) {
      try {
        if (!global.localStorage) return false;
        global.localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (e) { return false; }
    },

    /* Phase 6(8950-8955): C1 セーブデータ(c1_world_data / barcode_data_c1)を保存 */
    saveGameC1: function (c1WorldData, barcodeDataC1) {
      var data = this.load();
      data.save = {
        c1_world_data: serializeWorldData(c1WorldData),
        barcode_data_c1: Array.isArray(barcodeDataC1)
          ? barcodeDataC1.map(serializeBarcodeData)
          : [null, null, null, null, null, null, null]
      };
      return this.saveSettings(data);
    },

    /* Phase 6(9046-9055): C1 セーブデータを復元(C1WorldData / BarcodeData インスタンス化) */
    loadGameC1: function () {
      var data = this.load();
      if (!data.save || typeof data.save !== 'object') {
        return { c1WorldData: null, barcodeDataC1: null };
      }
      var w = deserializeWorldData(data.save.c1_world_data);
      var arr = Array.isArray(data.save.barcode_data_c1)
        ? data.save.barcode_data_c1.map(deserializeBarcodeData)
        : null;
      return { c1WorldData: w, barcodeDataC1: arr };
    }
  };

  BB2.Store = Store;
})(typeof window !== 'undefined' ? window : this);
