// import BinanceApi, Util

function State(state) {
  var self = this;
  self.listeners = {};
  for (var key in state) {
    (function(key) {
      var getterName = key;
      var setterName = "set" + key.capitalize();
      self[getterName] = function(def, mapDef) {
        if (!(key in state)) {
          return def;
        } else if (typeof state[key] == 'object' && typeof def != 'undefined') {
          return state[key][def] || mapDef;
        } else {
          return state[key];
        }
      }
      self[setterName] = function(mixed, atKeyValue) {
        if (typeof state[key] == 'object' && typeof atKeyValue != 'undefined') {
          var oldValue = state[key][atKeyValue];
          state[key][mixed] = atKeyValue;
          self.dispatchEvent(
              key, {key: key, value: atKeyValue, oldValue: oldValue});
        } else {
          var oldValue = state[key];
          state[key] = mixed;
          self.dispatchEvent(key, {value: mixed, oldValue: oldValue});
        }
      }
      self.listeners[key] = [];
    })(key);
  }
}

State.prototype.createLockedHandler = function(lockName, handler) {
  var self = this;
  var setterName = "set" + lockName.capitalize();
  return function() {
    if (!self[lockName]()) {
      self[setterName](true);
      handler();
      self[setterName](false);
    }
  };
}

State.prototype.addEventListener = function(eventName, handler) {
  var self = this;
  self.listeners[eventName].push(handler);
}

State.prototype.dispatchEvent = function(eventName, eventArgs) {
  var self = this;
  if (!(eventName in self.listeners)) {
    return;
  }
  for (let handler of self.listeners[eventName]) {
    handler(eventArgs);
  }
}

function BalanceRow($row) {
  var self = this;
  $row.children().each(function() {
    var $cell = $(this);
    $cell.get(0).classList.forEach(function(className) {
      if (className.indexOf("-") >= 0) {
        return;
      }
      (function($cell) {
        self[className] = function(def) {
          return $cell.text() || def;
        }
      })($cell);
    });
  });
}

function Ninja(options) {
  this.api = options.api;
  this.settings = null;
  this.state = new State({
    // The value of BTC in USDT.
    btcValue: null,
    // Whether the UI is getting updated.
    digesting: false,
    // Mapping of coin symbol to it's ticker BTC price.
    btcPriceOf: null,
    // Mapping fo coin symbol to it's ticker USDT price.
    usdtPriceOf: null,
  });
}

Ninja.prototype.formatCell = function(mixed) {
  if (typeof mixed == 'undefined' || mixed === null) {
    return 'n/a';
  }

  if (typeof mixed != 'object') {
    return mixed;
  }

  var cellData = mixed;
  var displayValue = 'n/a';

  if (cellData.format == 'USD') {
    displayValue = '$ ' + (cellData.value * 1.0).toFixed(2);
  } else {
    displayValue = (cellData.value * 1.0).toFixed(8);
  }

  if (cellData.isMarket) {
    displayValue =
        '<strong title="' + cellData.title + '">' + displayValue + '</strong>';
  } else {
    displayValue =
        '<span title="' + cellData.title + '">' + displayValue + '</span>';
  }

  return displayValue;
}

Ninja.prototype.initUi = function() {
  $("body").addClass("binance-ninja-body");
}

Ninja.prototype.addColumn = function(options) {
  var ninja = this;
  var options = Object.assign({
    title: 'Header',
    key: 'cellClass',
    deps: {},
    compute: function(row, state) {},
    visible: false
  }, options);

  var $columnHeader = $('<div class="binance-ninja f-right"></div>');
  $columnHeader.addClass(options.key);
  $columnHeader.html(options.title);
  $columnHeader.insertBefore(
      $(".accountInfo-lists > li.th > .items > .action"));

  $(".accountInfo-lists > li.td > .items").each(function() {
    var $row = $(this);
    var $cell = $('<div class="binance-ninja f-right"></div>');
    $cell.addClass(options.key);
    $cell.insertBefore($row.find(".action"));

    var updateCell = ninja.state.createLockedHandler('digesting', function() {
      $cell.html(
          ninja.formatCell(options.compute(balanceRow, ninja.state)));
    });

    if (options.deps.state) {
      for (let stateDep of options.deps.state) {
        ninja.state.addEventListener(stateDep, updateCell);
      }
    }

    if (options.deps.row) {
      $row.bind("DOMSubtreeModified", updateCell);
    }

    var balanceRow = new BalanceRow($row);
    $cell.html('...');
  });

  $(".binance-ninja." + options.key).toggleClass(
      "binance-ninja-hidden", !options.visible);
}

Ninja.prototype.initColumns = function(settings) {
  var ninja = this;

  EXTRA_BALANCE_COLUMNS.forEach(function(col){
    if (col.compute) {
      ninja.addColumn(Object.assign(
          col,
          {visible: settings.balance_column_visibility[col.key]}));
    }
  });
}

Ninja.prototype.applySettings = function(settings) {
  var visibility = settings.balance_column_visibility;
  for (var key in visibility) {
    var $el = $(".binance-ninja." + key);
    if ($el.length == 0)
      continue;

    $el.toggleClass("binance-ninja-hidden", !visibility[key]);
  }
}

/** Initializes the Ninja. */
Ninja.prototype.init = function() {
  var ninja = this;
  Util.log("Started.");

  var promiseChain = [];

  promiseChain.push(
    loadSettings().then(function(settings) {
      ninja.settings = settings;
      Util.log("Loaded settings");
    }));

  promiseChain.push(
      ninja.api.convert({
        from: 'BTC',
        to: 'USDT',
        amount: '1'
      }).then(function(r) {
        Util.log("Lodeded BTC value");
        ninja.state.setBtcValue(r.price);
      }));

  promiseChain.push(
      ninja.api.getTickerPrices().then(function(r) {
        ninja.state.setBtcPriceOf(ninja.api.buildPriceMap(r, 'BTC'));
        ninja.state.setUsdtPriceOf(ninja.api.buildPriceMap(r, 'USDT'));
        Util.log("Loaded price maps");
      }));

  $(function() {
    ninja.initUi();
    ninja.initColumns(ninja.settings);
  });

  Promise.all(promiseChain).then(function() {
    Util.log("Initial loading complete.");
  });

  onSettingsChanged(ninja.applySettings.bind(ninja));
}
