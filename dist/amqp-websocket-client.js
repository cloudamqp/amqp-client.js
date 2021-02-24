var AMQPWebsocketClient = (function () {
	'use strict';

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function createCommonjsModule(fn) {
	  var module = { exports: {} };
		return fn(module, module.exports), module.exports;
	}

	var check = function (it) {
	  return it && it.Math == Math && it;
	}; // https://github.com/zloirock/core-js/issues/86#issuecomment-115759028


	var global$1 =
	/* global globalThis -- safe */
	check(typeof globalThis == 'object' && globalThis) || check(typeof window == 'object' && window) || check(typeof self == 'object' && self) || check(typeof commonjsGlobal == 'object' && commonjsGlobal) || // eslint-disable-next-line no-new-func -- fallback
	function () {
	  return this;
	}() || Function('return this')();

	var fails = function (exec) {
	  try {
	    return !!exec();
	  } catch (error) {
	    return true;
	  }
	};

	// Detect IE8's incomplete defineProperty implementation


	var descriptors = !fails(function () {
	  return Object.defineProperty({}, 1, {
	    get: function () {
	      return 7;
	    }
	  })[1] != 7;
	});

	var nativePropertyIsEnumerable = {}.propertyIsEnumerable;
	var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; // Nashorn ~ JDK8 bug

	var NASHORN_BUG = getOwnPropertyDescriptor && !nativePropertyIsEnumerable.call({
	  1: 2
	}, 1); // `Object.prototype.propertyIsEnumerable` method implementation
	// https://tc39.es/ecma262/#sec-object.prototype.propertyisenumerable

	var f = NASHORN_BUG ? function propertyIsEnumerable(V) {
	  var descriptor = getOwnPropertyDescriptor(this, V);
	  return !!descriptor && descriptor.enumerable;
	} : nativePropertyIsEnumerable;

	var objectPropertyIsEnumerable = {
		f: f
	};

	var createPropertyDescriptor = function (bitmap, value) {
	  return {
	    enumerable: !(bitmap & 1),
	    configurable: !(bitmap & 2),
	    writable: !(bitmap & 4),
	    value: value
	  };
	};

	var toString = {}.toString;

	var classofRaw = function (it) {
	  return toString.call(it).slice(8, -1);
	};

	var split = ''.split; // fallback for non-array-like ES3 and non-enumerable old V8 strings

	var indexedObject = fails(function () {
	  // throws an error in rhino, see https://github.com/mozilla/rhino/issues/346
	  // eslint-disable-next-line no-prototype-builtins -- safe
	  return !Object('z').propertyIsEnumerable(0);
	}) ? function (it) {
	  return classofRaw(it) == 'String' ? split.call(it, '') : Object(it);
	} : Object;

	// `RequireObjectCoercible` abstract operation
	// https://tc39.es/ecma262/#sec-requireobjectcoercible
	var requireObjectCoercible = function (it) {
	  if (it == undefined) throw TypeError("Can't call method on " + it);
	  return it;
	};

	// toObject with fallback for non-array-like ES3 strings




	var toIndexedObject = function (it) {
	  return indexedObject(requireObjectCoercible(it));
	};

	var isObject = function (it) {
	  return typeof it === 'object' ? it !== null : typeof it === 'function';
	};

	// `ToPrimitive` abstract operation
	// https://tc39.es/ecma262/#sec-toprimitive
	// instead of the ES6 spec version, we didn't implement @@toPrimitive case
	// and the second argument - flag - preferred type is a string


	var toPrimitive = function (input, PREFERRED_STRING) {
	  if (!isObject(input)) return input;
	  var fn, val;
	  if (PREFERRED_STRING && typeof (fn = input.toString) == 'function' && !isObject(val = fn.call(input))) return val;
	  if (typeof (fn = input.valueOf) == 'function' && !isObject(val = fn.call(input))) return val;
	  if (!PREFERRED_STRING && typeof (fn = input.toString) == 'function' && !isObject(val = fn.call(input))) return val;
	  throw TypeError("Can't convert object to primitive value");
	};

	var hasOwnProperty = {}.hasOwnProperty;

	var has = function (it, key) {
	  return hasOwnProperty.call(it, key);
	};

	var document$1 = global$1.document; // typeof document.createElement is 'object' in old IE

	var EXISTS = isObject(document$1) && isObject(document$1.createElement);

	var documentCreateElement = function (it) {
	  return EXISTS ? document$1.createElement(it) : {};
	};

	// Thank's IE8 for his funny defineProperty


	var ie8DomDefine = !descriptors && !fails(function () {
	  return Object.defineProperty(documentCreateElement('div'), 'a', {
	    get: function () {
	      return 7;
	    }
	  }).a != 7;
	});

	var nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; // `Object.getOwnPropertyDescriptor` method
	// https://tc39.es/ecma262/#sec-object.getownpropertydescriptor

	var f$1 = descriptors ? nativeGetOwnPropertyDescriptor : function getOwnPropertyDescriptor(O, P) {
	  O = toIndexedObject(O);
	  P = toPrimitive(P, true);
	  if (ie8DomDefine) try {
	    return nativeGetOwnPropertyDescriptor(O, P);
	  } catch (error) {
	    /* empty */
	  }
	  if (has(O, P)) return createPropertyDescriptor(!objectPropertyIsEnumerable.f.call(O, P), O[P]);
	};

	var objectGetOwnPropertyDescriptor = {
		f: f$1
	};

	var anObject = function (it) {
	  if (!isObject(it)) {
	    throw TypeError(String(it) + ' is not an object');
	  }

	  return it;
	};

	var nativeDefineProperty = Object.defineProperty; // `Object.defineProperty` method
	// https://tc39.es/ecma262/#sec-object.defineproperty

	var f$2 = descriptors ? nativeDefineProperty : function defineProperty(O, P, Attributes) {
	  anObject(O);
	  P = toPrimitive(P, true);
	  anObject(Attributes);
	  if (ie8DomDefine) try {
	    return nativeDefineProperty(O, P, Attributes);
	  } catch (error) {
	    /* empty */
	  }
	  if ('get' in Attributes || 'set' in Attributes) throw TypeError('Accessors not supported');
	  if ('value' in Attributes) O[P] = Attributes.value;
	  return O;
	};

	var objectDefineProperty = {
		f: f$2
	};

	var createNonEnumerableProperty = descriptors ? function (object, key, value) {
	  return objectDefineProperty.f(object, key, createPropertyDescriptor(1, value));
	} : function (object, key, value) {
	  object[key] = value;
	  return object;
	};

	var setGlobal = function (key, value) {
	  try {
	    createNonEnumerableProperty(global$1, key, value);
	  } catch (error) {
	    global$1[key] = value;
	  }

	  return value;
	};

	var SHARED = '__core-js_shared__';
	var store = global$1[SHARED] || setGlobal(SHARED, {});
	var sharedStore = store;

	var functionToString = Function.toString; // this helper broken in `3.4.1-3.4.4`, so we can't use `shared` helper

	if (typeof sharedStore.inspectSource != 'function') {
	  sharedStore.inspectSource = function (it) {
	    return functionToString.call(it);
	  };
	}

	var inspectSource = sharedStore.inspectSource;

	var WeakMap = global$1.WeakMap;
	var nativeWeakMap = typeof WeakMap === 'function' && /native code/.test(inspectSource(WeakMap));

	var shared = createCommonjsModule(function (module) {
	(module.exports = function (key, value) {
	  return sharedStore[key] || (sharedStore[key] = value !== undefined ? value : {});
	})('versions', []).push({
	  version: '3.9.0',
	  mode: 'global',
	  copyright: '© 2021 Denis Pushkarev (zloirock.ru)'
	});
	});

	var id = 0;
	var postfix = Math.random();

	var uid = function (key) {
	  return 'Symbol(' + String(key === undefined ? '' : key) + ')_' + (++id + postfix).toString(36);
	};

	var keys = shared('keys');

	var sharedKey = function (key) {
	  return keys[key] || (keys[key] = uid(key));
	};

	var hiddenKeys = {};

	var WeakMap$1 = global$1.WeakMap;
	var set, get, has$1;

	var enforce = function (it) {
	  return has$1(it) ? get(it) : set(it, {});
	};

	var getterFor = function (TYPE) {
	  return function (it) {
	    var state;

	    if (!isObject(it) || (state = get(it)).type !== TYPE) {
	      throw TypeError('Incompatible receiver, ' + TYPE + ' required');
	    }

	    return state;
	  };
	};

	if (nativeWeakMap) {
	  var store$1 = sharedStore.state || (sharedStore.state = new WeakMap$1());
	  var wmget = store$1.get;
	  var wmhas = store$1.has;
	  var wmset = store$1.set;

	  set = function (it, metadata) {
	    metadata.facade = it;
	    wmset.call(store$1, it, metadata);
	    return metadata;
	  };

	  get = function (it) {
	    return wmget.call(store$1, it) || {};
	  };

	  has$1 = function (it) {
	    return wmhas.call(store$1, it);
	  };
	} else {
	  var STATE = sharedKey('state');
	  hiddenKeys[STATE] = true;

	  set = function (it, metadata) {
	    metadata.facade = it;
	    createNonEnumerableProperty(it, STATE, metadata);
	    return metadata;
	  };

	  get = function (it) {
	    return has(it, STATE) ? it[STATE] : {};
	  };

	  has$1 = function (it) {
	    return has(it, STATE);
	  };
	}

	var internalState = {
	  set: set,
	  get: get,
	  has: has$1,
	  enforce: enforce,
	  getterFor: getterFor
	};

	var redefine = createCommonjsModule(function (module) {
	var getInternalState = internalState.get;
	var enforceInternalState = internalState.enforce;
	var TEMPLATE = String(String).split('String');
	(module.exports = function (O, key, value, options) {
	  var unsafe = options ? !!options.unsafe : false;
	  var simple = options ? !!options.enumerable : false;
	  var noTargetGet = options ? !!options.noTargetGet : false;
	  var state;

	  if (typeof value == 'function') {
	    if (typeof key == 'string' && !has(value, 'name')) {
	      createNonEnumerableProperty(value, 'name', key);
	    }

	    state = enforceInternalState(value);

	    if (!state.source) {
	      state.source = TEMPLATE.join(typeof key == 'string' ? key : '');
	    }
	  }

	  if (O === global$1) {
	    if (simple) O[key] = value;else setGlobal(key, value);
	    return;
	  } else if (!unsafe) {
	    delete O[key];
	  } else if (!noTargetGet && O[key]) {
	    simple = true;
	  }

	  if (simple) O[key] = value;else createNonEnumerableProperty(O, key, value); // add fake Function#toString for correct work wrapped methods / constructors with methods like LoDash isNative
	})(Function.prototype, 'toString', function toString() {
	  return typeof this == 'function' && getInternalState(this).source || inspectSource(this);
	});
	});

	var path = global$1;

	var aFunction = function (variable) {
	  return typeof variable == 'function' ? variable : undefined;
	};

	var getBuiltIn = function (namespace, method) {
	  return arguments.length < 2 ? aFunction(path[namespace]) || aFunction(global$1[namespace]) : path[namespace] && path[namespace][method] || global$1[namespace] && global$1[namespace][method];
	};

	var ceil = Math.ceil;
	var floor = Math.floor; // `ToInteger` abstract operation
	// https://tc39.es/ecma262/#sec-tointeger

	var toInteger = function (argument) {
	  return isNaN(argument = +argument) ? 0 : (argument > 0 ? floor : ceil)(argument);
	};

	var min = Math.min; // `ToLength` abstract operation
	// https://tc39.es/ecma262/#sec-tolength

	var toLength = function (argument) {
	  return argument > 0 ? min(toInteger(argument), 0x1FFFFFFFFFFFFF) : 0; // 2 ** 53 - 1 == 9007199254740991
	};

	var max = Math.max;
	var min$1 = Math.min; // Helper for a popular repeating case of the spec:
	// Let integer be ? ToInteger(index).
	// If integer < 0, let result be max((length + integer), 0); else let result be min(integer, length).

	var toAbsoluteIndex = function (index, length) {
	  var integer = toInteger(index);
	  return integer < 0 ? max(integer + length, 0) : min$1(integer, length);
	};

	// `Array.prototype.{ indexOf, includes }` methods implementation


	var createMethod = function (IS_INCLUDES) {
	  return function ($this, el, fromIndex) {
	    var O = toIndexedObject($this);
	    var length = toLength(O.length);
	    var index = toAbsoluteIndex(fromIndex, length);
	    var value; // Array#includes uses SameValueZero equality algorithm
	    // eslint-disable-next-line no-self-compare -- NaN check

	    if (IS_INCLUDES && el != el) while (length > index) {
	      value = O[index++]; // eslint-disable-next-line no-self-compare -- NaN check

	      if (value != value) return true; // Array#indexOf ignores holes, Array#includes - not
	    } else for (; length > index; index++) {
	      if ((IS_INCLUDES || index in O) && O[index] === el) return IS_INCLUDES || index || 0;
	    }
	    return !IS_INCLUDES && -1;
	  };
	};

	var arrayIncludes = {
	  // `Array.prototype.includes` method
	  // https://tc39.es/ecma262/#sec-array.prototype.includes
	  includes: createMethod(true),
	  // `Array.prototype.indexOf` method
	  // https://tc39.es/ecma262/#sec-array.prototype.indexof
	  indexOf: createMethod(false)
	};

	var indexOf = arrayIncludes.indexOf;



	var objectKeysInternal = function (object, names) {
	  var O = toIndexedObject(object);
	  var i = 0;
	  var result = [];
	  var key;

	  for (key in O) !has(hiddenKeys, key) && has(O, key) && result.push(key); // Don't enum bug & hidden keys


	  while (names.length > i) if (has(O, key = names[i++])) {
	    ~indexOf(result, key) || result.push(key);
	  }

	  return result;
	};

	// IE8- don't enum bug keys
	var enumBugKeys = ['constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf'];

	var hiddenKeys$1 = enumBugKeys.concat('length', 'prototype'); // `Object.getOwnPropertyNames` method
	// https://tc39.es/ecma262/#sec-object.getownpropertynames

	var f$3 = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
	  return objectKeysInternal(O, hiddenKeys$1);
	};

	var objectGetOwnPropertyNames = {
		f: f$3
	};

	var f$4 = Object.getOwnPropertySymbols;

	var objectGetOwnPropertySymbols = {
		f: f$4
	};

	// all object keys, includes non-enumerable and symbols


	var ownKeys = getBuiltIn('Reflect', 'ownKeys') || function ownKeys(it) {
	  var keys = objectGetOwnPropertyNames.f(anObject(it));
	  var getOwnPropertySymbols = objectGetOwnPropertySymbols.f;
	  return getOwnPropertySymbols ? keys.concat(getOwnPropertySymbols(it)) : keys;
	};

	var copyConstructorProperties = function (target, source) {
	  var keys = ownKeys(source);
	  var defineProperty = objectDefineProperty.f;
	  var getOwnPropertyDescriptor = objectGetOwnPropertyDescriptor.f;

	  for (var i = 0; i < keys.length; i++) {
	    var key = keys[i];
	    if (!has(target, key)) defineProperty(target, key, getOwnPropertyDescriptor(source, key));
	  }
	};

	var replacement = /#|\.prototype\./;

	var isForced = function (feature, detection) {
	  var value = data[normalize(feature)];
	  return value == POLYFILL ? true : value == NATIVE ? false : typeof detection == 'function' ? fails(detection) : !!detection;
	};

	var normalize = isForced.normalize = function (string) {
	  return String(string).replace(replacement, '.').toLowerCase();
	};

	var data = isForced.data = {};
	var NATIVE = isForced.NATIVE = 'N';
	var POLYFILL = isForced.POLYFILL = 'P';
	var isForced_1 = isForced;

	var getOwnPropertyDescriptor$1 = objectGetOwnPropertyDescriptor.f;










	/*
	  options.target      - name of the target object
	  options.global      - target is the global object
	  options.stat        - export as static methods of target
	  options.proto       - export as prototype methods of target
	  options.real        - real prototype method for the `pure` version
	  options.forced      - export even if the native feature is available
	  options.bind        - bind methods to the target, required for the `pure` version
	  options.wrap        - wrap constructors to preventing global pollution, required for the `pure` version
	  options.unsafe      - use the simple assignment of property instead of delete + defineProperty
	  options.sham        - add a flag to not completely full polyfills
	  options.enumerable  - export as enumerable property
	  options.noTargetGet - prevent calling a getter on target
	*/


	var _export = function (options, source) {
	  var TARGET = options.target;
	  var GLOBAL = options.global;
	  var STATIC = options.stat;
	  var FORCED, target, key, targetProperty, sourceProperty, descriptor;

	  if (GLOBAL) {
	    target = global$1;
	  } else if (STATIC) {
	    target = global$1[TARGET] || setGlobal(TARGET, {});
	  } else {
	    target = (global$1[TARGET] || {}).prototype;
	  }

	  if (target) for (key in source) {
	    sourceProperty = source[key];

	    if (options.noTargetGet) {
	      descriptor = getOwnPropertyDescriptor$1(target, key);
	      targetProperty = descriptor && descriptor.value;
	    } else targetProperty = target[key];

	    FORCED = isForced_1(GLOBAL ? key : TARGET + (STATIC ? '.' : '#') + key, options.forced); // contained in target

	    if (!FORCED && targetProperty !== undefined) {
	      if (typeof sourceProperty === typeof targetProperty) continue;
	      copyConstructorProperties(sourceProperty, targetProperty);
	    } // add a flag to not completely full polyfills


	    if (options.sham || targetProperty && targetProperty.sham) {
	      createNonEnumerableProperty(sourceProperty, 'sham', true);
	    } // extend global


	    redefine(target, key, sourceProperty, options);
	  }
	};

	var nativeSymbol = !!Object.getOwnPropertySymbols && !fails(function () {
	  // Chrome 38 Symbol has incorrect toString conversion

	  /* global Symbol -- required for testing */
	  return !String(Symbol());
	});

	var useSymbolAsUid = nativeSymbol
	/* global Symbol -- safe */
	&& !Symbol.sham && typeof Symbol.iterator == 'symbol';

	var WellKnownSymbolsStore = shared('wks');
	var Symbol$1 = global$1.Symbol;
	var createWellKnownSymbol = useSymbolAsUid ? Symbol$1 : Symbol$1 && Symbol$1.withoutSetter || uid;

	var wellKnownSymbol = function (name) {
	  if (!has(WellKnownSymbolsStore, name)) {
	    if (nativeSymbol && has(Symbol$1, name)) WellKnownSymbolsStore[name] = Symbol$1[name];else WellKnownSymbolsStore[name] = createWellKnownSymbol('Symbol.' + name);
	  }

	  return WellKnownSymbolsStore[name];
	};

	var ITERATOR = wellKnownSymbol('iterator');
	var SAFE_CLOSING = false;

	try {
	  var called = 0;
	  var iteratorWithReturn = {
	    next: function () {
	      return {
	        done: !!called++
	      };
	    },
	    'return': function () {
	      SAFE_CLOSING = true;
	    }
	  };

	  iteratorWithReturn[ITERATOR] = function () {
	    return this;
	  }; // eslint-disable-next-line no-throw-literal -- required for testing


	  Array.from(iteratorWithReturn, function () {
	    throw 2;
	  });
	} catch (error) {
	  /* empty */
	}

	var checkCorrectnessOfIteration = function (exec, SKIP_CLOSING) {
	  if (!SKIP_CLOSING && !SAFE_CLOSING) return false;
	  var ITERATION_SUPPORT = false;

	  try {
	    var object = {};

	    object[ITERATOR] = function () {
	      return {
	        next: function () {
	          return {
	            done: ITERATION_SUPPORT = true
	          };
	        }
	      };
	    };

	    exec(object);
	  } catch (error) {
	    /* empty */
	  }

	  return ITERATION_SUPPORT;
	};

	var arrayBufferNative = typeof ArrayBuffer !== 'undefined' && typeof DataView !== 'undefined';

	var TO_STRING_TAG = wellKnownSymbol('toStringTag');
	var test = {};
	test[TO_STRING_TAG] = 'z';
	var toStringTagSupport = String(test) === '[object z]';

	var TO_STRING_TAG$1 = wellKnownSymbol('toStringTag'); // ES3 wrong here

	var CORRECT_ARGUMENTS = classofRaw(function () {
	  return arguments;
	}()) == 'Arguments'; // fallback for IE11 Script Access Denied error

	var tryGet = function (it, key) {
	  try {
	    return it[key];
	  } catch (error) {
	    /* empty */
	  }
	}; // getting tag from ES6+ `Object.prototype.toString`


	var classof = toStringTagSupport ? classofRaw : function (it) {
	  var O, tag, result;
	  return it === undefined ? 'Undefined' : it === null ? 'Null' // @@toStringTag case
	  : typeof (tag = tryGet(O = Object(it), TO_STRING_TAG$1)) == 'string' ? tag // builtinTag case
	  : CORRECT_ARGUMENTS ? classofRaw(O) // ES3 arguments fallback
	  : (result = classofRaw(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : result;
	};

	// `ToObject` abstract operation
	// https://tc39.es/ecma262/#sec-toobject


	var toObject = function (argument) {
	  return Object(requireObjectCoercible(argument));
	};

	var correctPrototypeGetter = !fails(function () {
	  function F() {
	    /* empty */
	  }

	  F.prototype.constructor = null;
	  return Object.getPrototypeOf(new F()) !== F.prototype;
	});

	var IE_PROTO = sharedKey('IE_PROTO');
	var ObjectPrototype = Object.prototype; // `Object.getPrototypeOf` method
	// https://tc39.es/ecma262/#sec-object.getprototypeof

	var objectGetPrototypeOf = correctPrototypeGetter ? Object.getPrototypeOf : function (O) {
	  O = toObject(O);
	  if (has(O, IE_PROTO)) return O[IE_PROTO];

	  if (typeof O.constructor == 'function' && O instanceof O.constructor) {
	    return O.constructor.prototype;
	  }

	  return O instanceof Object ? ObjectPrototype : null;
	};

	var aPossiblePrototype = function (it) {
	  if (!isObject(it) && it !== null) {
	    throw TypeError("Can't set " + String(it) + ' as a prototype');
	  }

	  return it;
	};

	/* eslint-disable no-proto -- safe */

	// `Object.setPrototypeOf` method
	// https://tc39.es/ecma262/#sec-object.setprototypeof
	// Works with __proto__ only. Old v8 can't work with null proto objects.


	var objectSetPrototypeOf = Object.setPrototypeOf || ('__proto__' in {} ? function () {
	  var CORRECT_SETTER = false;
	  var test = {};
	  var setter;

	  try {
	    setter = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__').set;
	    setter.call(test, []);
	    CORRECT_SETTER = test instanceof Array;
	  } catch (error) {
	    /* empty */
	  }

	  return function setPrototypeOf(O, proto) {
	    anObject(O);
	    aPossiblePrototype(proto);
	    if (CORRECT_SETTER) setter.call(O, proto);else O.__proto__ = proto;
	    return O;
	  };
	}() : undefined);

	var defineProperty = objectDefineProperty.f;









	var Int8Array = global$1.Int8Array;
	var Int8ArrayPrototype = Int8Array && Int8Array.prototype;
	var Uint8ClampedArray = global$1.Uint8ClampedArray;
	var Uint8ClampedArrayPrototype = Uint8ClampedArray && Uint8ClampedArray.prototype;
	var TypedArray = Int8Array && objectGetPrototypeOf(Int8Array);
	var TypedArrayPrototype = Int8ArrayPrototype && objectGetPrototypeOf(Int8ArrayPrototype);
	var ObjectPrototype$1 = Object.prototype;
	var isPrototypeOf = ObjectPrototype$1.isPrototypeOf;
	var TO_STRING_TAG$2 = wellKnownSymbol('toStringTag');
	var TYPED_ARRAY_TAG = uid('TYPED_ARRAY_TAG'); // Fixing native typed arrays in Opera Presto crashes the browser, see #595

	var NATIVE_ARRAY_BUFFER_VIEWS = arrayBufferNative && !!objectSetPrototypeOf && classof(global$1.opera) !== 'Opera';
	var TYPED_ARRAY_TAG_REQIRED = false;
	var NAME;
	var TypedArrayConstructorsList = {
	  Int8Array: 1,
	  Uint8Array: 1,
	  Uint8ClampedArray: 1,
	  Int16Array: 2,
	  Uint16Array: 2,
	  Int32Array: 4,
	  Uint32Array: 4,
	  Float32Array: 4,
	  Float64Array: 8
	};
	var BigIntArrayConstructorsList = {
	  BigInt64Array: 8,
	  BigUint64Array: 8
	};

	var isView = function isView(it) {
	  if (!isObject(it)) return false;
	  var klass = classof(it);
	  return klass === 'DataView' || has(TypedArrayConstructorsList, klass) || has(BigIntArrayConstructorsList, klass);
	};

	var isTypedArray = function (it) {
	  if (!isObject(it)) return false;
	  var klass = classof(it);
	  return has(TypedArrayConstructorsList, klass) || has(BigIntArrayConstructorsList, klass);
	};

	var aTypedArray = function (it) {
	  if (isTypedArray(it)) return it;
	  throw TypeError('Target is not a typed array');
	};

	var aTypedArrayConstructor = function (C) {
	  if (objectSetPrototypeOf) {
	    if (isPrototypeOf.call(TypedArray, C)) return C;
	  } else for (var ARRAY in TypedArrayConstructorsList) if (has(TypedArrayConstructorsList, NAME)) {
	    var TypedArrayConstructor = global$1[ARRAY];

	    if (TypedArrayConstructor && (C === TypedArrayConstructor || isPrototypeOf.call(TypedArrayConstructor, C))) {
	      return C;
	    }
	  }

	  throw TypeError('Target is not a typed array constructor');
	};

	var exportTypedArrayMethod = function (KEY, property, forced) {
	  if (!descriptors) return;
	  if (forced) for (var ARRAY in TypedArrayConstructorsList) {
	    var TypedArrayConstructor = global$1[ARRAY];

	    if (TypedArrayConstructor && has(TypedArrayConstructor.prototype, KEY)) {
	      delete TypedArrayConstructor.prototype[KEY];
	    }
	  }

	  if (!TypedArrayPrototype[KEY] || forced) {
	    redefine(TypedArrayPrototype, KEY, forced ? property : NATIVE_ARRAY_BUFFER_VIEWS && Int8ArrayPrototype[KEY] || property);
	  }
	};

	var exportTypedArrayStaticMethod = function (KEY, property, forced) {
	  var ARRAY, TypedArrayConstructor;
	  if (!descriptors) return;

	  if (objectSetPrototypeOf) {
	    if (forced) for (ARRAY in TypedArrayConstructorsList) {
	      TypedArrayConstructor = global$1[ARRAY];

	      if (TypedArrayConstructor && has(TypedArrayConstructor, KEY)) {
	        delete TypedArrayConstructor[KEY];
	      }
	    }

	    if (!TypedArray[KEY] || forced) {
	      // V8 ~ Chrome 49-50 `%TypedArray%` methods are non-writable non-configurable
	      try {
	        return redefine(TypedArray, KEY, forced ? property : NATIVE_ARRAY_BUFFER_VIEWS && Int8Array[KEY] || property);
	      } catch (error) {
	        /* empty */
	      }
	    } else return;
	  }

	  for (ARRAY in TypedArrayConstructorsList) {
	    TypedArrayConstructor = global$1[ARRAY];

	    if (TypedArrayConstructor && (!TypedArrayConstructor[KEY] || forced)) {
	      redefine(TypedArrayConstructor, KEY, property);
	    }
	  }
	};

	for (NAME in TypedArrayConstructorsList) {
	  if (!global$1[NAME]) NATIVE_ARRAY_BUFFER_VIEWS = false;
	} // WebKit bug - typed arrays constructors prototype is Object.prototype


	if (!NATIVE_ARRAY_BUFFER_VIEWS || typeof TypedArray != 'function' || TypedArray === Function.prototype) {
	  // eslint-disable-next-line no-shadow -- safe
	  TypedArray = function TypedArray() {
	    throw TypeError('Incorrect invocation');
	  };

	  if (NATIVE_ARRAY_BUFFER_VIEWS) for (NAME in TypedArrayConstructorsList) {
	    if (global$1[NAME]) objectSetPrototypeOf(global$1[NAME], TypedArray);
	  }
	}

	if (!NATIVE_ARRAY_BUFFER_VIEWS || !TypedArrayPrototype || TypedArrayPrototype === ObjectPrototype$1) {
	  TypedArrayPrototype = TypedArray.prototype;
	  if (NATIVE_ARRAY_BUFFER_VIEWS) for (NAME in TypedArrayConstructorsList) {
	    if (global$1[NAME]) objectSetPrototypeOf(global$1[NAME].prototype, TypedArrayPrototype);
	  }
	} // WebKit bug - one more object in Uint8ClampedArray prototype chain


	if (NATIVE_ARRAY_BUFFER_VIEWS && objectGetPrototypeOf(Uint8ClampedArrayPrototype) !== TypedArrayPrototype) {
	  objectSetPrototypeOf(Uint8ClampedArrayPrototype, TypedArrayPrototype);
	}

	if (descriptors && !has(TypedArrayPrototype, TO_STRING_TAG$2)) {
	  TYPED_ARRAY_TAG_REQIRED = true;
	  defineProperty(TypedArrayPrototype, TO_STRING_TAG$2, {
	    get: function () {
	      return isObject(this) ? this[TYPED_ARRAY_TAG] : undefined;
	    }
	  });

	  for (NAME in TypedArrayConstructorsList) if (global$1[NAME]) {
	    createNonEnumerableProperty(global$1[NAME], TYPED_ARRAY_TAG, NAME);
	  }
	}

	var arrayBufferViewCore = {
	  NATIVE_ARRAY_BUFFER_VIEWS: NATIVE_ARRAY_BUFFER_VIEWS,
	  TYPED_ARRAY_TAG: TYPED_ARRAY_TAG_REQIRED && TYPED_ARRAY_TAG,
	  aTypedArray: aTypedArray,
	  aTypedArrayConstructor: aTypedArrayConstructor,
	  exportTypedArrayMethod: exportTypedArrayMethod,
	  exportTypedArrayStaticMethod: exportTypedArrayStaticMethod,
	  isView: isView,
	  isTypedArray: isTypedArray,
	  TypedArray: TypedArray,
	  TypedArrayPrototype: TypedArrayPrototype
	};

	/* eslint-disable no-new -- required for testing */

	var NATIVE_ARRAY_BUFFER_VIEWS$1 = arrayBufferViewCore.NATIVE_ARRAY_BUFFER_VIEWS;

	var ArrayBuffer$1 = global$1.ArrayBuffer;
	var Int8Array$1 = global$1.Int8Array;
	var typedArrayConstructorsRequireWrappers = !NATIVE_ARRAY_BUFFER_VIEWS$1 || !fails(function () {
	  Int8Array$1(1);
	}) || !fails(function () {
	  new Int8Array$1(-1);
	}) || !checkCorrectnessOfIteration(function (iterable) {
	  new Int8Array$1();
	  new Int8Array$1(null);
	  new Int8Array$1(1.5);
	  new Int8Array$1(iterable);
	}, true) || fails(function () {
	  // Safari (11+) bug - a reason why even Safari 13 should load a typed array polyfill
	  return new Int8Array$1(new ArrayBuffer$1(2), 1, undefined).length !== 1;
	});

	var redefineAll = function (target, src, options) {
	  for (var key in src) redefine(target, key, src[key], options);

	  return target;
	};

	var anInstance = function (it, Constructor, name) {
	  if (!(it instanceof Constructor)) {
	    throw TypeError('Incorrect ' + (name ? name + ' ' : '') + 'invocation');
	  }

	  return it;
	};

	// `ToIndex` abstract operation
	// https://tc39.es/ecma262/#sec-toindex


	var toIndex = function (it) {
	  if (it === undefined) return 0;
	  var number = toInteger(it);
	  var length = toLength(number);
	  if (number !== length) throw RangeError('Wrong length or index');
	  return length;
	};

	// IEEE754 conversions based on https://github.com/feross/ieee754
	var abs = Math.abs;
	var pow = Math.pow;
	var floor$1 = Math.floor;
	var log = Math.log;
	var LN2 = Math.LN2;

	var pack = function (number, mantissaLength, bytes) {
	  var buffer = new Array(bytes);
	  var exponentLength = bytes * 8 - mantissaLength - 1;
	  var eMax = (1 << exponentLength) - 1;
	  var eBias = eMax >> 1;
	  var rt = mantissaLength === 23 ? pow(2, -24) - pow(2, -77) : 0;
	  var sign = number < 0 || number === 0 && 1 / number < 0 ? 1 : 0;
	  var index = 0;
	  var exponent, mantissa, c;
	  number = abs(number); // eslint-disable-next-line no-self-compare -- NaN check

	  if (number != number || number === Infinity) {
	    // eslint-disable-next-line no-self-compare -- NaN check
	    mantissa = number != number ? 1 : 0;
	    exponent = eMax;
	  } else {
	    exponent = floor$1(log(number) / LN2);

	    if (number * (c = pow(2, -exponent)) < 1) {
	      exponent--;
	      c *= 2;
	    }

	    if (exponent + eBias >= 1) {
	      number += rt / c;
	    } else {
	      number += rt * pow(2, 1 - eBias);
	    }

	    if (number * c >= 2) {
	      exponent++;
	      c /= 2;
	    }

	    if (exponent + eBias >= eMax) {
	      mantissa = 0;
	      exponent = eMax;
	    } else if (exponent + eBias >= 1) {
	      mantissa = (number * c - 1) * pow(2, mantissaLength);
	      exponent = exponent + eBias;
	    } else {
	      mantissa = number * pow(2, eBias - 1) * pow(2, mantissaLength);
	      exponent = 0;
	    }
	  }

	  for (; mantissaLength >= 8; buffer[index++] = mantissa & 255, mantissa /= 256, mantissaLength -= 8);

	  exponent = exponent << mantissaLength | mantissa;
	  exponentLength += mantissaLength;

	  for (; exponentLength > 0; buffer[index++] = exponent & 255, exponent /= 256, exponentLength -= 8);

	  buffer[--index] |= sign * 128;
	  return buffer;
	};

	var unpack = function (buffer, mantissaLength) {
	  var bytes = buffer.length;
	  var exponentLength = bytes * 8 - mantissaLength - 1;
	  var eMax = (1 << exponentLength) - 1;
	  var eBias = eMax >> 1;
	  var nBits = exponentLength - 7;
	  var index = bytes - 1;
	  var sign = buffer[index--];
	  var exponent = sign & 127;
	  var mantissa;
	  sign >>= 7;

	  for (; nBits > 0; exponent = exponent * 256 + buffer[index], index--, nBits -= 8);

	  mantissa = exponent & (1 << -nBits) - 1;
	  exponent >>= -nBits;
	  nBits += mantissaLength;

	  for (; nBits > 0; mantissa = mantissa * 256 + buffer[index], index--, nBits -= 8);

	  if (exponent === 0) {
	    exponent = 1 - eBias;
	  } else if (exponent === eMax) {
	    return mantissa ? NaN : sign ? -Infinity : Infinity;
	  } else {
	    mantissa = mantissa + pow(2, mantissaLength);
	    exponent = exponent - eBias;
	  }

	  return (sign ? -1 : 1) * mantissa * pow(2, exponent - mantissaLength);
	};

	var ieee754 = {
	  pack: pack,
	  unpack: unpack
	};

	// `Array.prototype.fill` method implementation
	// https://tc39.es/ecma262/#sec-array.prototype.fill


	var arrayFill = function fill(value
	/* , start = 0, end = @length */
	) {
	  var O = toObject(this);
	  var length = toLength(O.length);
	  var argumentsLength = arguments.length;
	  var index = toAbsoluteIndex(argumentsLength > 1 ? arguments[1] : undefined, length);
	  var end = argumentsLength > 2 ? arguments[2] : undefined;
	  var endPos = end === undefined ? length : toAbsoluteIndex(end, length);

	  while (endPos > index) O[index++] = value;

	  return O;
	};

	var defineProperty$1 = objectDefineProperty.f;





	var TO_STRING_TAG$3 = wellKnownSymbol('toStringTag');

	var setToStringTag = function (it, TAG, STATIC) {
	  if (it && !has(it = STATIC ? it : it.prototype, TO_STRING_TAG$3)) {
	    defineProperty$1(it, TO_STRING_TAG$3, {
	      configurable: true,
	      value: TAG
	    });
	  }
	};

	var getOwnPropertyNames = objectGetOwnPropertyNames.f;

	var defineProperty$2 = objectDefineProperty.f;







	var getInternalState = internalState.get;
	var setInternalState = internalState.set;
	var ARRAY_BUFFER = 'ArrayBuffer';
	var DATA_VIEW = 'DataView';
	var PROTOTYPE = 'prototype';
	var WRONG_LENGTH = 'Wrong length';
	var WRONG_INDEX = 'Wrong index';
	var NativeArrayBuffer = global$1[ARRAY_BUFFER];
	var $ArrayBuffer = NativeArrayBuffer;
	var $DataView = global$1[DATA_VIEW];
	var $DataViewPrototype = $DataView && $DataView[PROTOTYPE];
	var ObjectPrototype$2 = Object.prototype;
	var RangeError$1 = global$1.RangeError;
	var packIEEE754 = ieee754.pack;
	var unpackIEEE754 = ieee754.unpack;

	var packInt8 = function (number) {
	  return [number & 0xFF];
	};

	var packInt16 = function (number) {
	  return [number & 0xFF, number >> 8 & 0xFF];
	};

	var packInt32 = function (number) {
	  return [number & 0xFF, number >> 8 & 0xFF, number >> 16 & 0xFF, number >> 24 & 0xFF];
	};

	var unpackInt32 = function (buffer) {
	  return buffer[3] << 24 | buffer[2] << 16 | buffer[1] << 8 | buffer[0];
	};

	var packFloat32 = function (number) {
	  return packIEEE754(number, 23, 4);
	};

	var packFloat64 = function (number) {
	  return packIEEE754(number, 52, 8);
	};

	var addGetter = function (Constructor, key) {
	  defineProperty$2(Constructor[PROTOTYPE], key, {
	    get: function () {
	      return getInternalState(this)[key];
	    }
	  });
	};

	var get$1 = function (view, count, index, isLittleEndian) {
	  var intIndex = toIndex(index);
	  var store = getInternalState(view);
	  if (intIndex + count > store.byteLength) throw RangeError$1(WRONG_INDEX);
	  var bytes = getInternalState(store.buffer).bytes;
	  var start = intIndex + store.byteOffset;
	  var pack = bytes.slice(start, start + count);
	  return isLittleEndian ? pack : pack.reverse();
	};

	var set$1 = function (view, count, index, conversion, value, isLittleEndian) {
	  var intIndex = toIndex(index);
	  var store = getInternalState(view);
	  if (intIndex + count > store.byteLength) throw RangeError$1(WRONG_INDEX);
	  var bytes = getInternalState(store.buffer).bytes;
	  var start = intIndex + store.byteOffset;
	  var pack = conversion(+value);

	  for (var i = 0; i < count; i++) bytes[start + i] = pack[isLittleEndian ? i : count - i - 1];
	};

	if (!arrayBufferNative) {
	  $ArrayBuffer = function ArrayBuffer(length) {
	    anInstance(this, $ArrayBuffer, ARRAY_BUFFER);
	    var byteLength = toIndex(length);
	    setInternalState(this, {
	      bytes: arrayFill.call(new Array(byteLength), 0),
	      byteLength: byteLength
	    });
	    if (!descriptors) this.byteLength = byteLength;
	  };

	  $DataView = function DataView(buffer, byteOffset, byteLength) {
	    anInstance(this, $DataView, DATA_VIEW);
	    anInstance(buffer, $ArrayBuffer, DATA_VIEW);
	    var bufferLength = getInternalState(buffer).byteLength;
	    var offset = toInteger(byteOffset);
	    if (offset < 0 || offset > bufferLength) throw RangeError$1('Wrong offset');
	    byteLength = byteLength === undefined ? bufferLength - offset : toLength(byteLength);
	    if (offset + byteLength > bufferLength) throw RangeError$1(WRONG_LENGTH);
	    setInternalState(this, {
	      buffer: buffer,
	      byteLength: byteLength,
	      byteOffset: offset
	    });

	    if (!descriptors) {
	      this.buffer = buffer;
	      this.byteLength = byteLength;
	      this.byteOffset = offset;
	    }
	  };

	  if (descriptors) {
	    addGetter($ArrayBuffer, 'byteLength');
	    addGetter($DataView, 'buffer');
	    addGetter($DataView, 'byteLength');
	    addGetter($DataView, 'byteOffset');
	  }

	  redefineAll($DataView[PROTOTYPE], {
	    getInt8: function getInt8(byteOffset) {
	      return get$1(this, 1, byteOffset)[0] << 24 >> 24;
	    },
	    getUint8: function getUint8(byteOffset) {
	      return get$1(this, 1, byteOffset)[0];
	    },
	    getInt16: function getInt16(byteOffset
	    /* , littleEndian */
	    ) {
	      var bytes = get$1(this, 2, byteOffset, arguments.length > 1 ? arguments[1] : undefined);
	      return (bytes[1] << 8 | bytes[0]) << 16 >> 16;
	    },
	    getUint16: function getUint16(byteOffset
	    /* , littleEndian */
	    ) {
	      var bytes = get$1(this, 2, byteOffset, arguments.length > 1 ? arguments[1] : undefined);
	      return bytes[1] << 8 | bytes[0];
	    },
	    getInt32: function getInt32(byteOffset
	    /* , littleEndian */
	    ) {
	      return unpackInt32(get$1(this, 4, byteOffset, arguments.length > 1 ? arguments[1] : undefined));
	    },
	    getUint32: function getUint32(byteOffset
	    /* , littleEndian */
	    ) {
	      return unpackInt32(get$1(this, 4, byteOffset, arguments.length > 1 ? arguments[1] : undefined)) >>> 0;
	    },
	    getFloat32: function getFloat32(byteOffset
	    /* , littleEndian */
	    ) {
	      return unpackIEEE754(get$1(this, 4, byteOffset, arguments.length > 1 ? arguments[1] : undefined), 23);
	    },
	    getFloat64: function getFloat64(byteOffset
	    /* , littleEndian */
	    ) {
	      return unpackIEEE754(get$1(this, 8, byteOffset, arguments.length > 1 ? arguments[1] : undefined), 52);
	    },
	    setInt8: function setInt8(byteOffset, value) {
	      set$1(this, 1, byteOffset, packInt8, value);
	    },
	    setUint8: function setUint8(byteOffset, value) {
	      set$1(this, 1, byteOffset, packInt8, value);
	    },
	    setInt16: function setInt16(byteOffset, value
	    /* , littleEndian */
	    ) {
	      set$1(this, 2, byteOffset, packInt16, value, arguments.length > 2 ? arguments[2] : undefined);
	    },
	    setUint16: function setUint16(byteOffset, value
	    /* , littleEndian */
	    ) {
	      set$1(this, 2, byteOffset, packInt16, value, arguments.length > 2 ? arguments[2] : undefined);
	    },
	    setInt32: function setInt32(byteOffset, value
	    /* , littleEndian */
	    ) {
	      set$1(this, 4, byteOffset, packInt32, value, arguments.length > 2 ? arguments[2] : undefined);
	    },
	    setUint32: function setUint32(byteOffset, value
	    /* , littleEndian */
	    ) {
	      set$1(this, 4, byteOffset, packInt32, value, arguments.length > 2 ? arguments[2] : undefined);
	    },
	    setFloat32: function setFloat32(byteOffset, value
	    /* , littleEndian */
	    ) {
	      set$1(this, 4, byteOffset, packFloat32, value, arguments.length > 2 ? arguments[2] : undefined);
	    },
	    setFloat64: function setFloat64(byteOffset, value
	    /* , littleEndian */
	    ) {
	      set$1(this, 8, byteOffset, packFloat64, value, arguments.length > 2 ? arguments[2] : undefined);
	    }
	  });
	} else {
	  /* eslint-disable no-new -- required for testing */
	  if (!fails(function () {
	    NativeArrayBuffer(1);
	  }) || !fails(function () {
	    new NativeArrayBuffer(-1);
	  }) || fails(function () {
	    new NativeArrayBuffer();
	    new NativeArrayBuffer(1.5);
	    new NativeArrayBuffer(NaN);
	    return NativeArrayBuffer.name != ARRAY_BUFFER;
	  })) {
	    /* eslint-enable no-new -- required for testing */
	    $ArrayBuffer = function ArrayBuffer(length) {
	      anInstance(this, $ArrayBuffer);
	      return new NativeArrayBuffer(toIndex(length));
	    };

	    var ArrayBufferPrototype = $ArrayBuffer[PROTOTYPE] = NativeArrayBuffer[PROTOTYPE];

	    for (var keys$1 = getOwnPropertyNames(NativeArrayBuffer), j = 0, key; keys$1.length > j;) {
	      if (!((key = keys$1[j++]) in $ArrayBuffer)) {
	        createNonEnumerableProperty($ArrayBuffer, key, NativeArrayBuffer[key]);
	      }
	    }

	    ArrayBufferPrototype.constructor = $ArrayBuffer;
	  } // WebKit bug - the same parent prototype for typed arrays and data view


	  if (objectSetPrototypeOf && objectGetPrototypeOf($DataViewPrototype) !== ObjectPrototype$2) {
	    objectSetPrototypeOf($DataViewPrototype, ObjectPrototype$2);
	  } // iOS Safari 7.x bug


	  var testView = new $DataView(new $ArrayBuffer(2));
	  var nativeSetInt8 = $DataViewPrototype.setInt8;
	  testView.setInt8(0, 2147483648);
	  testView.setInt8(1, 2147483649);
	  if (testView.getInt8(0) || !testView.getInt8(1)) redefineAll($DataViewPrototype, {
	    setInt8: function setInt8(byteOffset, value) {
	      nativeSetInt8.call(this, byteOffset, value << 24 >> 24);
	    },
	    setUint8: function setUint8(byteOffset, value) {
	      nativeSetInt8.call(this, byteOffset, value << 24 >> 24);
	    }
	  }, {
	    unsafe: true
	  });
	}

	setToStringTag($ArrayBuffer, ARRAY_BUFFER);
	setToStringTag($DataView, DATA_VIEW);
	var arrayBuffer = {
	  ArrayBuffer: $ArrayBuffer,
	  DataView: $DataView
	};

	var toPositiveInteger = function (it) {
	  var result = toInteger(it);
	  if (result < 0) throw RangeError("The argument can't be less than 0");
	  return result;
	};

	var toOffset = function (it, BYTES) {
	  var offset = toPositiveInteger(it);
	  if (offset % BYTES) throw RangeError('Wrong offset');
	  return offset;
	};

	// `Object.keys` method
	// https://tc39.es/ecma262/#sec-object.keys


	var objectKeys = Object.keys || function keys(O) {
	  return objectKeysInternal(O, enumBugKeys);
	};

	// `Object.defineProperties` method
	// https://tc39.es/ecma262/#sec-object.defineproperties


	var objectDefineProperties = descriptors ? Object.defineProperties : function defineProperties(O, Properties) {
	  anObject(O);
	  var keys = objectKeys(Properties);
	  var length = keys.length;
	  var index = 0;
	  var key;

	  while (length > index) objectDefineProperty.f(O, key = keys[index++], Properties[key]);

	  return O;
	};

	var html = getBuiltIn('document', 'documentElement');

	var GT = '>';
	var LT = '<';
	var PROTOTYPE$1 = 'prototype';
	var SCRIPT = 'script';
	var IE_PROTO$1 = sharedKey('IE_PROTO');

	var EmptyConstructor = function () {
	  /* empty */
	};

	var scriptTag = function (content) {
	  return LT + SCRIPT + GT + content + LT + '/' + SCRIPT + GT;
	}; // Create object with fake `null` prototype: use ActiveX Object with cleared prototype


	var NullProtoObjectViaActiveX = function (activeXDocument) {
	  activeXDocument.write(scriptTag(''));
	  activeXDocument.close();
	  var temp = activeXDocument.parentWindow.Object;
	  activeXDocument = null; // avoid memory leak

	  return temp;
	}; // Create object with fake `null` prototype: use iframe Object with cleared prototype


	var NullProtoObjectViaIFrame = function () {
	  // Thrash, waste and sodomy: IE GC bug
	  var iframe = documentCreateElement('iframe');
	  var JS = 'java' + SCRIPT + ':';
	  var iframeDocument;
	  iframe.style.display = 'none';
	  html.appendChild(iframe); // https://github.com/zloirock/core-js/issues/475

	  iframe.src = String(JS);
	  iframeDocument = iframe.contentWindow.document;
	  iframeDocument.open();
	  iframeDocument.write(scriptTag('document.F=Object'));
	  iframeDocument.close();
	  return iframeDocument.F;
	}; // Check for document.domain and active x support
	// No need to use active x approach when document.domain is not set
	// see https://github.com/es-shims/es5-shim/issues/150
	// variation of https://github.com/kitcambridge/es5-shim/commit/4f738ac066346
	// avoid IE GC bug


	var activeXDocument;

	var NullProtoObject = function () {
	  try {
	    /* global ActiveXObject -- old IE */
	    activeXDocument = document.domain && new ActiveXObject('htmlfile');
	  } catch (error) {
	    /* ignore */
	  }

	  NullProtoObject = activeXDocument ? NullProtoObjectViaActiveX(activeXDocument) : NullProtoObjectViaIFrame();
	  var length = enumBugKeys.length;

	  while (length--) delete NullProtoObject[PROTOTYPE$1][enumBugKeys[length]];

	  return NullProtoObject();
	};

	hiddenKeys[IE_PROTO$1] = true; // `Object.create` method
	// https://tc39.es/ecma262/#sec-object.create

	var objectCreate = Object.create || function create(O, Properties) {
	  var result;

	  if (O !== null) {
	    EmptyConstructor[PROTOTYPE$1] = anObject(O);
	    result = new EmptyConstructor();
	    EmptyConstructor[PROTOTYPE$1] = null; // add "__proto__" for Object.getPrototypeOf polyfill

	    result[IE_PROTO$1] = O;
	  } else result = NullProtoObject();

	  return Properties === undefined ? result : objectDefineProperties(result, Properties);
	};

	var iterators = {};

	var ITERATOR$1 = wellKnownSymbol('iterator');

	var getIteratorMethod = function (it) {
	  if (it != undefined) return it[ITERATOR$1] || it['@@iterator'] || iterators[classof(it)];
	};

	var ITERATOR$2 = wellKnownSymbol('iterator');
	var ArrayPrototype = Array.prototype; // check on default Array iterator

	var isArrayIteratorMethod = function (it) {
	  return it !== undefined && (iterators.Array === it || ArrayPrototype[ITERATOR$2] === it);
	};

	var aFunction$1 = function (it) {
	  if (typeof it != 'function') {
	    throw TypeError(String(it) + ' is not a function');
	  }

	  return it;
	};

	// optional / simple context binding


	var functionBindContext = function (fn, that, length) {
	  aFunction$1(fn);
	  if (that === undefined) return fn;

	  switch (length) {
	    case 0:
	      return function () {
	        return fn.call(that);
	      };

	    case 1:
	      return function (a) {
	        return fn.call(that, a);
	      };

	    case 2:
	      return function (a, b) {
	        return fn.call(that, a, b);
	      };

	    case 3:
	      return function (a, b, c) {
	        return fn.call(that, a, b, c);
	      };
	  }

	  return function ()
	  /* ...args */
	  {
	    return fn.apply(that, arguments);
	  };
	};

	var aTypedArrayConstructor$1 = arrayBufferViewCore.aTypedArrayConstructor;

	var typedArrayFrom = function from(source
	/* , mapfn, thisArg */
	) {
	  var O = toObject(source);
	  var argumentsLength = arguments.length;
	  var mapfn = argumentsLength > 1 ? arguments[1] : undefined;
	  var mapping = mapfn !== undefined;
	  var iteratorMethod = getIteratorMethod(O);
	  var i, length, result, step, iterator, next;

	  if (iteratorMethod != undefined && !isArrayIteratorMethod(iteratorMethod)) {
	    iterator = iteratorMethod.call(O);
	    next = iterator.next;
	    O = [];

	    while (!(step = next.call(iterator)).done) {
	      O.push(step.value);
	    }
	  }

	  if (mapping && argumentsLength > 2) {
	    mapfn = functionBindContext(mapfn, arguments[2], 2);
	  }

	  length = toLength(O.length);
	  result = new (aTypedArrayConstructor$1(this))(length);

	  for (i = 0; length > i; i++) {
	    result[i] = mapping ? mapfn(O[i], i) : O[i];
	  }

	  return result;
	};

	// `IsArray` abstract operation
	// https://tc39.es/ecma262/#sec-isarray


	var isArray = Array.isArray || function isArray(arg) {
	  return classofRaw(arg) == 'Array';
	};

	var SPECIES = wellKnownSymbol('species'); // `ArraySpeciesCreate` abstract operation
	// https://tc39.es/ecma262/#sec-arrayspeciescreate

	var arraySpeciesCreate = function (originalArray, length) {
	  var C;

	  if (isArray(originalArray)) {
	    C = originalArray.constructor; // cross-realm fallback

	    if (typeof C == 'function' && (C === Array || isArray(C.prototype))) C = undefined;else if (isObject(C)) {
	      C = C[SPECIES];
	      if (C === null) C = undefined;
	    }
	  }

	  return new (C === undefined ? Array : C)(length === 0 ? 0 : length);
	};

	var push = [].push; // `Array.prototype.{ forEach, map, filter, some, every, find, findIndex, filterOut }` methods implementation

	var createMethod$1 = function (TYPE) {
	  var IS_MAP = TYPE == 1;
	  var IS_FILTER = TYPE == 2;
	  var IS_SOME = TYPE == 3;
	  var IS_EVERY = TYPE == 4;
	  var IS_FIND_INDEX = TYPE == 6;
	  var IS_FILTER_OUT = TYPE == 7;
	  var NO_HOLES = TYPE == 5 || IS_FIND_INDEX;
	  return function ($this, callbackfn, that, specificCreate) {
	    var O = toObject($this);
	    var self = indexedObject(O);
	    var boundFunction = functionBindContext(callbackfn, that, 3);
	    var length = toLength(self.length);
	    var index = 0;
	    var create = specificCreate || arraySpeciesCreate;
	    var target = IS_MAP ? create($this, length) : IS_FILTER || IS_FILTER_OUT ? create($this, 0) : undefined;
	    var value, result;

	    for (; length > index; index++) if (NO_HOLES || index in self) {
	      value = self[index];
	      result = boundFunction(value, index, O);

	      if (TYPE) {
	        if (IS_MAP) target[index] = result; // map
	        else if (result) switch (TYPE) {
	            case 3:
	              return true;
	            // some

	            case 5:
	              return value;
	            // find

	            case 6:
	              return index;
	            // findIndex

	            case 2:
	              push.call(target, value);
	            // filter
	          } else switch (TYPE) {
	            case 4:
	              return false;
	            // every

	            case 7:
	              push.call(target, value);
	            // filterOut
	          }
	      }
	    }

	    return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : target;
	  };
	};

	var arrayIteration = {
	  // `Array.prototype.forEach` method
	  // https://tc39.es/ecma262/#sec-array.prototype.foreach
	  forEach: createMethod$1(0),
	  // `Array.prototype.map` method
	  // https://tc39.es/ecma262/#sec-array.prototype.map
	  map: createMethod$1(1),
	  // `Array.prototype.filter` method
	  // https://tc39.es/ecma262/#sec-array.prototype.filter
	  filter: createMethod$1(2),
	  // `Array.prototype.some` method
	  // https://tc39.es/ecma262/#sec-array.prototype.some
	  some: createMethod$1(3),
	  // `Array.prototype.every` method
	  // https://tc39.es/ecma262/#sec-array.prototype.every
	  every: createMethod$1(4),
	  // `Array.prototype.find` method
	  // https://tc39.es/ecma262/#sec-array.prototype.find
	  find: createMethod$1(5),
	  // `Array.prototype.findIndex` method
	  // https://tc39.es/ecma262/#sec-array.prototype.findIndex
	  findIndex: createMethod$1(6),
	  // `Array.prototype.filterOut` method
	  // https://github.com/tc39/proposal-array-filtering
	  filterOut: createMethod$1(7)
	};

	var SPECIES$1 = wellKnownSymbol('species');

	var setSpecies = function (CONSTRUCTOR_NAME) {
	  var Constructor = getBuiltIn(CONSTRUCTOR_NAME);
	  var defineProperty = objectDefineProperty.f;

	  if (descriptors && Constructor && !Constructor[SPECIES$1]) {
	    defineProperty(Constructor, SPECIES$1, {
	      configurable: true,
	      get: function () {
	        return this;
	      }
	    });
	  }
	};

	// makes subclassing work correct for wrapped built-ins


	var inheritIfRequired = function ($this, dummy, Wrapper) {
	  var NewTarget, NewTargetPrototype;
	  if ( // it can work only with native `setPrototypeOf`
	  objectSetPrototypeOf && // we haven't completely correct pre-ES6 way for getting `new.target`, so use this
	  typeof (NewTarget = dummy.constructor) == 'function' && NewTarget !== Wrapper && isObject(NewTargetPrototype = NewTarget.prototype) && NewTargetPrototype !== Wrapper.prototype) objectSetPrototypeOf($this, NewTargetPrototype);
	  return $this;
	};

	var typedArrayConstructor = createCommonjsModule(function (module) {





































	var getOwnPropertyNames = objectGetOwnPropertyNames.f;



	var forEach = arrayIteration.forEach;











	var getInternalState = internalState.get;
	var setInternalState = internalState.set;
	var nativeDefineProperty = objectDefineProperty.f;
	var nativeGetOwnPropertyDescriptor = objectGetOwnPropertyDescriptor.f;
	var round = Math.round;
	var RangeError = global$1.RangeError;
	var ArrayBuffer = arrayBuffer.ArrayBuffer;
	var DataView = arrayBuffer.DataView;
	var NATIVE_ARRAY_BUFFER_VIEWS = arrayBufferViewCore.NATIVE_ARRAY_BUFFER_VIEWS;
	var TYPED_ARRAY_TAG = arrayBufferViewCore.TYPED_ARRAY_TAG;
	var TypedArray = arrayBufferViewCore.TypedArray;
	var TypedArrayPrototype = arrayBufferViewCore.TypedArrayPrototype;
	var aTypedArrayConstructor = arrayBufferViewCore.aTypedArrayConstructor;
	var isTypedArray = arrayBufferViewCore.isTypedArray;
	var BYTES_PER_ELEMENT = 'BYTES_PER_ELEMENT';
	var WRONG_LENGTH = 'Wrong length';

	var fromList = function (C, list) {
	  var index = 0;
	  var length = list.length;
	  var result = new (aTypedArrayConstructor(C))(length);

	  while (length > index) result[index] = list[index++];

	  return result;
	};

	var addGetter = function (it, key) {
	  nativeDefineProperty(it, key, {
	    get: function () {
	      return getInternalState(this)[key];
	    }
	  });
	};

	var isArrayBuffer = function (it) {
	  var klass;
	  return it instanceof ArrayBuffer || (klass = classof(it)) == 'ArrayBuffer' || klass == 'SharedArrayBuffer';
	};

	var isTypedArrayIndex = function (target, key) {
	  return isTypedArray(target) && typeof key != 'symbol' && key in target && String(+key) == String(key);
	};

	var wrappedGetOwnPropertyDescriptor = function getOwnPropertyDescriptor(target, key) {
	  return isTypedArrayIndex(target, key = toPrimitive(key, true)) ? createPropertyDescriptor(2, target[key]) : nativeGetOwnPropertyDescriptor(target, key);
	};

	var wrappedDefineProperty = function defineProperty(target, key, descriptor) {
	  if (isTypedArrayIndex(target, key = toPrimitive(key, true)) && isObject(descriptor) && has(descriptor, 'value') && !has(descriptor, 'get') && !has(descriptor, 'set') // TODO: add validation descriptor w/o calling accessors
	  && !descriptor.configurable && (!has(descriptor, 'writable') || descriptor.writable) && (!has(descriptor, 'enumerable') || descriptor.enumerable)) {
	    target[key] = descriptor.value;
	    return target;
	  }

	  return nativeDefineProperty(target, key, descriptor);
	};

	if (descriptors) {
	  if (!NATIVE_ARRAY_BUFFER_VIEWS) {
	    objectGetOwnPropertyDescriptor.f = wrappedGetOwnPropertyDescriptor;
	    objectDefineProperty.f = wrappedDefineProperty;
	    addGetter(TypedArrayPrototype, 'buffer');
	    addGetter(TypedArrayPrototype, 'byteOffset');
	    addGetter(TypedArrayPrototype, 'byteLength');
	    addGetter(TypedArrayPrototype, 'length');
	  }

	  _export({
	    target: 'Object',
	    stat: true,
	    forced: !NATIVE_ARRAY_BUFFER_VIEWS
	  }, {
	    getOwnPropertyDescriptor: wrappedGetOwnPropertyDescriptor,
	    defineProperty: wrappedDefineProperty
	  });

	  module.exports = function (TYPE, wrapper, CLAMPED) {
	    var BYTES = TYPE.match(/\d+$/)[0] / 8;
	    var CONSTRUCTOR_NAME = TYPE + (CLAMPED ? 'Clamped' : '') + 'Array';
	    var GETTER = 'get' + TYPE;
	    var SETTER = 'set' + TYPE;
	    var NativeTypedArrayConstructor = global$1[CONSTRUCTOR_NAME];
	    var TypedArrayConstructor = NativeTypedArrayConstructor;
	    var TypedArrayConstructorPrototype = TypedArrayConstructor && TypedArrayConstructor.prototype;
	    var exported = {};

	    var getter = function (that, index) {
	      var data = getInternalState(that);
	      return data.view[GETTER](index * BYTES + data.byteOffset, true);
	    };

	    var setter = function (that, index, value) {
	      var data = getInternalState(that);
	      if (CLAMPED) value = (value = round(value)) < 0 ? 0 : value > 0xFF ? 0xFF : value & 0xFF;
	      data.view[SETTER](index * BYTES + data.byteOffset, value, true);
	    };

	    var addElement = function (that, index) {
	      nativeDefineProperty(that, index, {
	        get: function () {
	          return getter(this, index);
	        },
	        set: function (value) {
	          return setter(this, index, value);
	        },
	        enumerable: true
	      });
	    };

	    if (!NATIVE_ARRAY_BUFFER_VIEWS) {
	      TypedArrayConstructor = wrapper(function (that, data, offset, $length) {
	        anInstance(that, TypedArrayConstructor, CONSTRUCTOR_NAME);
	        var index = 0;
	        var byteOffset = 0;
	        var buffer, byteLength, length;

	        if (!isObject(data)) {
	          length = toIndex(data);
	          byteLength = length * BYTES;
	          buffer = new ArrayBuffer(byteLength);
	        } else if (isArrayBuffer(data)) {
	          buffer = data;
	          byteOffset = toOffset(offset, BYTES);
	          var $len = data.byteLength;

	          if ($length === undefined) {
	            if ($len % BYTES) throw RangeError(WRONG_LENGTH);
	            byteLength = $len - byteOffset;
	            if (byteLength < 0) throw RangeError(WRONG_LENGTH);
	          } else {
	            byteLength = toLength($length) * BYTES;
	            if (byteLength + byteOffset > $len) throw RangeError(WRONG_LENGTH);
	          }

	          length = byteLength / BYTES;
	        } else if (isTypedArray(data)) {
	          return fromList(TypedArrayConstructor, data);
	        } else {
	          return typedArrayFrom.call(TypedArrayConstructor, data);
	        }

	        setInternalState(that, {
	          buffer: buffer,
	          byteOffset: byteOffset,
	          byteLength: byteLength,
	          length: length,
	          view: new DataView(buffer)
	        });

	        while (index < length) addElement(that, index++);
	      });
	      if (objectSetPrototypeOf) objectSetPrototypeOf(TypedArrayConstructor, TypedArray);
	      TypedArrayConstructorPrototype = TypedArrayConstructor.prototype = objectCreate(TypedArrayPrototype);
	    } else if (typedArrayConstructorsRequireWrappers) {
	      TypedArrayConstructor = wrapper(function (dummy, data, typedArrayOffset, $length) {
	        anInstance(dummy, TypedArrayConstructor, CONSTRUCTOR_NAME);
	        return inheritIfRequired(function () {
	          if (!isObject(data)) return new NativeTypedArrayConstructor(toIndex(data));
	          if (isArrayBuffer(data)) return $length !== undefined ? new NativeTypedArrayConstructor(data, toOffset(typedArrayOffset, BYTES), $length) : typedArrayOffset !== undefined ? new NativeTypedArrayConstructor(data, toOffset(typedArrayOffset, BYTES)) : new NativeTypedArrayConstructor(data);
	          if (isTypedArray(data)) return fromList(TypedArrayConstructor, data);
	          return typedArrayFrom.call(TypedArrayConstructor, data);
	        }(), dummy, TypedArrayConstructor);
	      });
	      if (objectSetPrototypeOf) objectSetPrototypeOf(TypedArrayConstructor, TypedArray);
	      forEach(getOwnPropertyNames(NativeTypedArrayConstructor), function (key) {
	        if (!(key in TypedArrayConstructor)) {
	          createNonEnumerableProperty(TypedArrayConstructor, key, NativeTypedArrayConstructor[key]);
	        }
	      });
	      TypedArrayConstructor.prototype = TypedArrayConstructorPrototype;
	    }

	    if (TypedArrayConstructorPrototype.constructor !== TypedArrayConstructor) {
	      createNonEnumerableProperty(TypedArrayConstructorPrototype, 'constructor', TypedArrayConstructor);
	    }

	    if (TYPED_ARRAY_TAG) {
	      createNonEnumerableProperty(TypedArrayConstructorPrototype, TYPED_ARRAY_TAG, CONSTRUCTOR_NAME);
	    }

	    exported[CONSTRUCTOR_NAME] = TypedArrayConstructor;
	    _export({
	      global: true,
	      forced: TypedArrayConstructor != NativeTypedArrayConstructor,
	      sham: !NATIVE_ARRAY_BUFFER_VIEWS
	    }, exported);

	    if (!(BYTES_PER_ELEMENT in TypedArrayConstructor)) {
	      createNonEnumerableProperty(TypedArrayConstructor, BYTES_PER_ELEMENT, BYTES);
	    }

	    if (!(BYTES_PER_ELEMENT in TypedArrayConstructorPrototype)) {
	      createNonEnumerableProperty(TypedArrayConstructorPrototype, BYTES_PER_ELEMENT, BYTES);
	    }

	    setSpecies(CONSTRUCTOR_NAME);
	  };
	} else module.exports = function () {
	  /* empty */
	};
	});

	// `Uint8Array` constructor
	// https://tc39.es/ecma262/#sec-typedarray-objects


	typedArrayConstructor('Uint8', function (init) {
	  return function Uint8Array(data, byteOffset, length) {
	    return init(this, data, byteOffset, length);
	  };
	});

	// iterable DOM collections
	// flag - `iterable` interface - 'entries', 'keys', 'values', 'forEach' methods
	var domIterables = {
	  CSSRuleList: 0,
	  CSSStyleDeclaration: 0,
	  CSSValueList: 0,
	  ClientRectList: 0,
	  DOMRectList: 0,
	  DOMStringList: 0,
	  DOMTokenList: 1,
	  DataTransferItemList: 0,
	  FileList: 0,
	  HTMLAllCollection: 0,
	  HTMLCollection: 0,
	  HTMLFormElement: 0,
	  HTMLSelectElement: 0,
	  MediaList: 0,
	  MimeTypeArray: 0,
	  NamedNodeMap: 0,
	  NodeList: 1,
	  PaintRequestList: 0,
	  Plugin: 0,
	  PluginArray: 0,
	  SVGLengthList: 0,
	  SVGNumberList: 0,
	  SVGPathSegList: 0,
	  SVGPointList: 0,
	  SVGStringList: 0,
	  SVGTransformList: 0,
	  SourceBufferList: 0,
	  StyleSheetList: 0,
	  TextTrackCueList: 0,
	  TextTrackList: 0,
	  TouchList: 0
	};

	var UNSCOPABLES = wellKnownSymbol('unscopables');
	var ArrayPrototype$1 = Array.prototype; // Array.prototype[@@unscopables]
	// https://tc39.es/ecma262/#sec-array.prototype-@@unscopables

	if (ArrayPrototype$1[UNSCOPABLES] == undefined) {
	  objectDefineProperty.f(ArrayPrototype$1, UNSCOPABLES, {
	    configurable: true,
	    value: objectCreate(null)
	  });
	} // add a key to Array.prototype[@@unscopables]


	var addToUnscopables = function (key) {
	  ArrayPrototype$1[UNSCOPABLES][key] = true;
	};

	var ITERATOR$3 = wellKnownSymbol('iterator');
	var BUGGY_SAFARI_ITERATORS = false;

	var returnThis = function () {
	  return this;
	}; // `%IteratorPrototype%` object
	// https://tc39.es/ecma262/#sec-%iteratorprototype%-object


	var IteratorPrototype, PrototypeOfArrayIteratorPrototype, arrayIterator;

	if ([].keys) {
	  arrayIterator = [].keys(); // Safari 8 has buggy iterators w/o `next`

	  if (!('next' in arrayIterator)) BUGGY_SAFARI_ITERATORS = true;else {
	    PrototypeOfArrayIteratorPrototype = objectGetPrototypeOf(objectGetPrototypeOf(arrayIterator));
	    if (PrototypeOfArrayIteratorPrototype !== Object.prototype) IteratorPrototype = PrototypeOfArrayIteratorPrototype;
	  }
	}

	var NEW_ITERATOR_PROTOTYPE = IteratorPrototype == undefined || fails(function () {
	  var test = {}; // FF44- legacy iterators case

	  return IteratorPrototype[ITERATOR$3].call(test) !== test;
	});
	if (NEW_ITERATOR_PROTOTYPE) IteratorPrototype = {}; // 25.1.2.1.1 %IteratorPrototype%[@@iterator]()

	if (!has(IteratorPrototype, ITERATOR$3)) {
	  createNonEnumerableProperty(IteratorPrototype, ITERATOR$3, returnThis);
	}

	var iteratorsCore = {
	  IteratorPrototype: IteratorPrototype,
	  BUGGY_SAFARI_ITERATORS: BUGGY_SAFARI_ITERATORS
	};

	var IteratorPrototype$1 = iteratorsCore.IteratorPrototype;









	var returnThis$1 = function () {
	  return this;
	};

	var createIteratorConstructor = function (IteratorConstructor, NAME, next) {
	  var TO_STRING_TAG = NAME + ' Iterator';
	  IteratorConstructor.prototype = objectCreate(IteratorPrototype$1, {
	    next: createPropertyDescriptor(1, next)
	  });
	  setToStringTag(IteratorConstructor, TO_STRING_TAG, false);
	  iterators[TO_STRING_TAG] = returnThis$1;
	  return IteratorConstructor;
	};

	var IteratorPrototype$2 = iteratorsCore.IteratorPrototype;
	var BUGGY_SAFARI_ITERATORS$1 = iteratorsCore.BUGGY_SAFARI_ITERATORS;
	var ITERATOR$4 = wellKnownSymbol('iterator');
	var KEYS = 'keys';
	var VALUES = 'values';
	var ENTRIES = 'entries';

	var returnThis$2 = function () {
	  return this;
	};

	var defineIterator = function (Iterable, NAME, IteratorConstructor, next, DEFAULT, IS_SET, FORCED) {
	  createIteratorConstructor(IteratorConstructor, NAME, next);

	  var getIterationMethod = function (KIND) {
	    if (KIND === DEFAULT && defaultIterator) return defaultIterator;
	    if (!BUGGY_SAFARI_ITERATORS$1 && KIND in IterablePrototype) return IterablePrototype[KIND];

	    switch (KIND) {
	      case KEYS:
	        return function keys() {
	          return new IteratorConstructor(this, KIND);
	        };

	      case VALUES:
	        return function values() {
	          return new IteratorConstructor(this, KIND);
	        };

	      case ENTRIES:
	        return function entries() {
	          return new IteratorConstructor(this, KIND);
	        };
	    }

	    return function () {
	      return new IteratorConstructor(this);
	    };
	  };

	  var TO_STRING_TAG = NAME + ' Iterator';
	  var INCORRECT_VALUES_NAME = false;
	  var IterablePrototype = Iterable.prototype;
	  var nativeIterator = IterablePrototype[ITERATOR$4] || IterablePrototype['@@iterator'] || DEFAULT && IterablePrototype[DEFAULT];
	  var defaultIterator = !BUGGY_SAFARI_ITERATORS$1 && nativeIterator || getIterationMethod(DEFAULT);
	  var anyNativeIterator = NAME == 'Array' ? IterablePrototype.entries || nativeIterator : nativeIterator;
	  var CurrentIteratorPrototype, methods, KEY; // fix native

	  if (anyNativeIterator) {
	    CurrentIteratorPrototype = objectGetPrototypeOf(anyNativeIterator.call(new Iterable()));

	    if (IteratorPrototype$2 !== Object.prototype && CurrentIteratorPrototype.next) {
	      if (objectGetPrototypeOf(CurrentIteratorPrototype) !== IteratorPrototype$2) {
	        if (objectSetPrototypeOf) {
	          objectSetPrototypeOf(CurrentIteratorPrototype, IteratorPrototype$2);
	        } else if (typeof CurrentIteratorPrototype[ITERATOR$4] != 'function') {
	          createNonEnumerableProperty(CurrentIteratorPrototype, ITERATOR$4, returnThis$2);
	        }
	      } // Set @@toStringTag to native iterators


	      setToStringTag(CurrentIteratorPrototype, TO_STRING_TAG, true);
	    }
	  } // fix Array#{values, @@iterator}.name in V8 / FF


	  if (DEFAULT == VALUES && nativeIterator && nativeIterator.name !== VALUES) {
	    INCORRECT_VALUES_NAME = true;

	    defaultIterator = function values() {
	      return nativeIterator.call(this);
	    };
	  } // define iterator


	  if (IterablePrototype[ITERATOR$4] !== defaultIterator) {
	    createNonEnumerableProperty(IterablePrototype, ITERATOR$4, defaultIterator);
	  }

	  iterators[NAME] = defaultIterator; // export additional methods

	  if (DEFAULT) {
	    methods = {
	      values: getIterationMethod(VALUES),
	      keys: IS_SET ? defaultIterator : getIterationMethod(KEYS),
	      entries: getIterationMethod(ENTRIES)
	    };
	    if (FORCED) for (KEY in methods) {
	      if (BUGGY_SAFARI_ITERATORS$1 || INCORRECT_VALUES_NAME || !(KEY in IterablePrototype)) {
	        redefine(IterablePrototype, KEY, methods[KEY]);
	      }
	    } else _export({
	      target: NAME,
	      proto: true,
	      forced: BUGGY_SAFARI_ITERATORS$1 || INCORRECT_VALUES_NAME
	    }, methods);
	  }

	  return methods;
	};

	var ARRAY_ITERATOR = 'Array Iterator';
	var setInternalState$1 = internalState.set;
	var getInternalState$1 = internalState.getterFor(ARRAY_ITERATOR); // `Array.prototype.entries` method
	// https://tc39.es/ecma262/#sec-array.prototype.entries
	// `Array.prototype.keys` method
	// https://tc39.es/ecma262/#sec-array.prototype.keys
	// `Array.prototype.values` method
	// https://tc39.es/ecma262/#sec-array.prototype.values
	// `Array.prototype[@@iterator]` method
	// https://tc39.es/ecma262/#sec-array.prototype-@@iterator
	// `CreateArrayIterator` internal method
	// https://tc39.es/ecma262/#sec-createarrayiterator

	var es_array_iterator = defineIterator(Array, 'Array', function (iterated, kind) {
	  setInternalState$1(this, {
	    type: ARRAY_ITERATOR,
	    target: toIndexedObject(iterated),
	    // target
	    index: 0,
	    // next index
	    kind: kind // kind

	  }); // `%ArrayIteratorPrototype%.next` method
	  // https://tc39.es/ecma262/#sec-%arrayiteratorprototype%.next
	}, function () {
	  var state = getInternalState$1(this);
	  var target = state.target;
	  var kind = state.kind;
	  var index = state.index++;

	  if (!target || index >= target.length) {
	    state.target = undefined;
	    return {
	      value: undefined,
	      done: true
	    };
	  }

	  if (kind == 'keys') return {
	    value: index,
	    done: false
	  };
	  if (kind == 'values') return {
	    value: target[index],
	    done: false
	  };
	  return {
	    value: [index, target[index]],
	    done: false
	  };
	}, 'values'); // argumentsList[@@iterator] is %ArrayProto_values%
	// https://tc39.es/ecma262/#sec-createunmappedargumentsobject
	// https://tc39.es/ecma262/#sec-createmappedargumentsobject

	iterators.Arguments = iterators.Array; // https://tc39.es/ecma262/#sec-array.prototype-@@unscopables

	addToUnscopables('keys');
	addToUnscopables('values');
	addToUnscopables('entries');

	var ITERATOR$5 = wellKnownSymbol('iterator');
	var TO_STRING_TAG$4 = wellKnownSymbol('toStringTag');
	var ArrayValues = es_array_iterator.values;

	for (var COLLECTION_NAME in domIterables) {
	  var Collection = global$1[COLLECTION_NAME];
	  var CollectionPrototype = Collection && Collection.prototype;

	  if (CollectionPrototype) {
	    // some Chrome versions have non-configurable methods on DOMTokenList
	    if (CollectionPrototype[ITERATOR$5] !== ArrayValues) try {
	      createNonEnumerableProperty(CollectionPrototype, ITERATOR$5, ArrayValues);
	    } catch (error) {
	      CollectionPrototype[ITERATOR$5] = ArrayValues;
	    }

	    if (!CollectionPrototype[TO_STRING_TAG$4]) {
	      createNonEnumerableProperty(CollectionPrototype, TO_STRING_TAG$4, COLLECTION_NAME);
	    }

	    if (domIterables[COLLECTION_NAME]) for (var METHOD_NAME in es_array_iterator) {
	      // some Chrome versions have non-configurable methods on DOMTokenList
	      if (CollectionPrototype[METHOD_NAME] !== es_array_iterator[METHOD_NAME]) try {
	        createNonEnumerableProperty(CollectionPrototype, METHOD_NAME, es_array_iterator[METHOD_NAME]);
	      } catch (error) {
	        CollectionPrototype[METHOD_NAME] = es_array_iterator[METHOD_NAME];
	      }
	    }
	  }
	}

	class AMQPError extends Error {
	  constructor(message, connection) {
	    super(message);
	    this.name = "AMQPError";
	    this.connection = connection;
	  }

	}

	class AMQPConsumer {
	  constructor(channel, tag, onMessage) {
	    this.channel = channel;
	    this.tag = tag;
	    this.onMessage = onMessage;
	  }

	  setClosed(err) {
	    this.closed = true;
	    this.closedError = err;
	    clearTimeout(this.timeoutId);

	    if (err) {
	      if (this.rejectWait) this.rejectWait(err);
	    } else {
	      if (this.resolveWait) this.resolveWait();
	    }
	  }

	  cancel() {
	    return this.channel.basicCancel(this.tag);
	  }
	  /** Wait for the consumer to finish
	    * Returns a Promise that
	    * resolves if the consumer/channel/connection is closed by the client
	    * rejects if the server closed or there was a network error */


	  wait(timeout) {
	    if (this.closedError) return Promise.reject(this.closedError);
	    if (this.closed) return Promise.resolve();
	    return new Promise((resolve, reject) => {
	      this.resolveWait = resolve;
	      this.rejectWait = reject;

	      if (timeout) {
	        const onTimeout = () => reject(new AMQPError("Timeout", this.channel.connection));

	        this.timeoutId = setTimeout(onTimeout, timeout);
	      }
	    });
	  }

	}

	class AMQPQueue {
	  constructor(channel, name) {
	    this.channel = channel;
	    this.name = name;
	  }

	  bind(exchange, routingkey, args = {}) {
	    return new Promise((resolve, reject) => {
	      this.channel.queueBind(this.name, exchange, routingkey, args).then(() => resolve(this)).catch(reject);
	    });
	  }

	  unbind(exchange, routingkey, args = {}) {
	    return new Promise((resolve, reject) => {
	      this.channel.queueUnind(this.name, exchange, routingkey, args).then(() => resolve(this)).catch(reject);
	    });
	  }

	  publish(body, properties) {
	    return new Promise((resolve, reject) => {
	      this.channel.basicPublish("", this.name, body, properties).then(() => resolve(this)).catch(reject);
	    });
	  }

	  subscribe({
	    noAck = true,
	    exclusive = false
	  } = {}, callback) {
	    return new Promise((resolve, reject) => {
	      this.channel.basicConsume(this.name, {
	        noAck,
	        exclusive
	      }, callback).then(resolve).catch(reject);
	    });
	  }

	  unsubscribe(consumerTag) {
	    return new Promise((resolve, reject) => {
	      this.channel.basicCancel(consumerTag).then(() => resolve(this)).catch(reject);
	    });
	  }

	  delete() {
	    return new Promise((resolve, reject) => {
	      this.channel.queueDelete(this.name).then(() => resolve(this)).catch(reject);
	    });
	  }

	}

	class AMQPView extends DataView {
	  getUint64(byteOffset, littleEndian) {
	    // split 64-bit number into two 32-bit (4-byte) parts
	    const left = this.getUint32(byteOffset, littleEndian);
	    const right = this.getUint32(byteOffset + 4, littleEndian); // combine the two 32-bit values

	    const combined = littleEndian ? left + 2 ** 32 * right : 2 ** 32 * left + right;
	    if (!Number.isSafeInteger(combined)) console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost');
	    return combined;
	  }

	  setUint64(byteOffset, value, littleEndian) {
	    this.setBigUint64(byteOffset, BigInt(value), littleEndian);
	  }

	  getInt64(byteOffset, value, littleEndian) {
	    return Number(this.getBigInt64(byteOffset, littleEndian));
	  }

	  setInt64(byteOffset, value, littleEndian) {
	    this.setBigInt64(byteOffset, BigInt(value), littleEndian);
	  }

	  getShortString(byteOffset, littleEndian) {
	    const len = this.getUint8(byteOffset, littleEndian);
	    byteOffset += 1;
	    const view = new Uint8Array(this.buffer, byteOffset, len);
	    const decoder = new TextDecoder();
	    return [decoder.decode(view), len + 1];
	  }

	  setShortString(byteOffset, string, littleEndian) {
	    const encoder = new TextEncoder();
	    const utf8 = encoder.encode(string);
	    this.setUint8(byteOffset, utf8.byteLength, littleEndian);
	    byteOffset += 1;
	    const view = new Uint8Array(this.buffer, byteOffset);
	    view.set(utf8);
	    return utf8.byteLength + 1;
	  }

	  getLongString(byteOffset, littleEndian) {
	    const len = this.getUint32(byteOffset, littleEndian);
	    byteOffset += 4;
	    const view = new Uint8Array(this.buffer, byteOffset, len);
	    const decoder = new TextDecoder();
	    return [decoder.decode(view), len + 4];
	  }

	  setLongString(byteOffset, string, littleEndian) {
	    const encoder = new TextEncoder();
	    const utf8 = encoder.encode(string);
	    this.setUint32(byteOffset, utf8.byteLength, littleEndian);
	    byteOffset += 4;
	    const view = new Uint8Array(this.buffer, byteOffset);
	    view.set(utf8);
	    return utf8.byteLength + 4;
	  }

	  getProperties(byteOffset, littleEndian) {
	    let j = byteOffset;
	    const flags = this.getUint16(j, littleEndian);
	    j += 2;
	    const props = {};

	    if ((flags & 0x8000) > 0) {
	      const [contentType, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.contentType = contentType;
	    }

	    if ((flags & 0x4000) > 0) {
	      const [contentEncoding, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.contentEncoding = contentEncoding;
	    }

	    if ((flags & 0x2000) > 0) {
	      const [headers, len] = this.getTable(j, littleEndian);
	      j += len;
	      props.headers = headers;
	    }

	    if ((flags & 0x1000) > 0) {
	      props.deliveryMode = this.getUint8(j, littleEndian);
	      j += 1;
	    }

	    if ((flags & 0x0800) > 0) {
	      props.priority = this.getUint8(j, littleEndian);
	      j += 1;
	    }

	    if ((flags & 0x0400) > 0) {
	      const [correlationId, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.correlationId = correlationId;
	    }

	    if ((flags & 0x0200) > 0) {
	      const [replyTo, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.replyTo = replyTo;
	    }

	    if ((flags & 0x0100) > 0) {
	      const [expiration, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.expiration = expiration;
	    }

	    if ((flags & 0x0080) > 0) {
	      const [messageId, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.messageId = messageId;
	    }

	    if ((flags & 0x0040) > 0) {
	      props.timestamp = new Date(this.getInt64(j, littleEndian) * 1000);
	      j += 8;
	    }

	    if ((flags & 0x0020) > 0) {
	      const [type, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.type = type;
	    }

	    if ((flags & 0x0010) > 0) {
	      const [userId, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.userId = userId;
	    }

	    if ((flags & 0x0008) > 0) {
	      const [appId, len] = this.getShortString(j, littleEndian);
	      j += len;
	      props.appId = appId;
	    }

	    const len = j - byteOffset;
	    return [props, len];
	  }

	  setProperties(byteOffset, properties, littleEndian) {
	    let j = byteOffset;
	    let flags = 0;
	    if (!properties) properties = {};
	    if (properties.contentType) flags = flags | 0x8000;
	    if (properties.contentEncoding) flags = flags | 0x4000;
	    if (properties.headers) flags = flags | 0x2000;
	    if (properties.deliveryMode) flags = flags | 0x1000;
	    if (properties.priority) flags = flags | 0x0800;
	    if (properties.correlationId) flags = flags | 0x0400;
	    if (properties.replyTo) flags = flags | 0x0200;
	    if (properties.expiration) flags = flags | 0x0100;
	    if (properties.messageId) flags = flags | 0x0080;
	    if (properties.timestamp) flags = flags | 0x0040;
	    if (properties.type) flags = flags | 0x0020;
	    if (properties.userId) flags = flags | 0x0010;
	    if (properties.appId) flags = flags | 0x0008;
	    this.setUint16(j, flags, littleEndian);
	    j += 2;

	    if (properties.contentType) {
	      j += this.setShortString(j, properties.contentType);
	    }

	    if (properties.contentEncoding) {
	      j += this.setShortString(j, properties.contentEncoding);
	    }

	    if (properties.headers) {
	      j += this.setTable(j, properties.headers);
	    }

	    if (properties.deliveryMode) {
	      this.setUint8(j, properties.deliveryMode);
	      j += 1;
	    }

	    if (properties.priority) {
	      this.setUint8(j, properties.priority);
	      j += 1;
	    }

	    if (properties.correlationId) {
	      j += this.setShortString(j, properties.correlationId);
	    }

	    if (properties.replyTo) {
	      j += this.setShortString(j, properties.replyTo);
	    }

	    if (properties.expiration) {
	      j += this.setShortString(j, properties.expiration);
	    }

	    if (properties.messageId) {
	      j += this.setShortString(j, properties.messageId);
	    }

	    if (properties.timestamp) {
	      // Date
	      const unixEpoch = Math.floor(Number(properties.timestamp) / 1000);
	      this.setInt64(j, unixEpoch, littleEndian);
	      j += 8;
	    }

	    if (properties.type) {
	      j += this.setShortString(j, properties.type);
	    }

	    if (properties.userId) {
	      j += this.setShortString(j, properties.userId);
	    }

	    if (properties.appId) {
	      j += this.setShortString(j, properties.appId);
	    }

	    const len = j - byteOffset;
	    return len;
	  }

	  getTable(byteOffset, littleEndian) {
	    const table = {};
	    let i = byteOffset;
	    const len = this.getUint32(byteOffset, littleEndian);
	    i += 4;

	    for (; i < byteOffset + 4 + len;) {
	      const [k, strLen] = this.getShortString(i, littleEndian);
	      i += strLen;
	      const [v, vLen] = this.getField(i, littleEndian);
	      i += vLen;
	      table[k] = v;
	    }

	    return [table, len + 4];
	  }

	  setTable(byteOffset, table, littleEndian) {
	    // skip the first 4 bytes which are for the size
	    let i = byteOffset + 4;

	    for (let [key, value] of Object.entries(table)) {
	      i += this.setShortString(i, key, littleEndian);
	      i += this.setField(i, value, littleEndian);
	    }

	    this.setUint32(byteOffset, i - byteOffset - 4, littleEndian); // update prefix length

	    return i - byteOffset;
	  }

	  getField(byteOffset, littleEndian) {
	    let i = byteOffset;
	    const k = this.getUint8(i, littleEndian);
	    i += 1;
	    const type = String.fromCharCode(k);
	    let v;
	    let len;

	    switch (type) {
	      case 't':
	        v = this.getUint8(i, littleEndian) === 1;
	        i += 1;
	        break;

	      case 'b':
	        v = this.getInt8(i, littleEndian);
	        i += 1;
	        break;

	      case 'B':
	        v = this.getUint8(i, littleEndian);
	        i += 1;
	        break;

	      case 's':
	        v = this.getInt16(i, littleEndian);
	        i += 2;
	        break;

	      case 'u':
	        v = this.getUint16(i, littleEndian);
	        i += 2;
	        break;

	      case 'I':
	        v = this.getInt32(i, littleEndian);
	        i += 4;
	        break;

	      case 'i':
	        v = this.getUint32(i, littleEndian);
	        i += 4;
	        break;

	      case 'l':
	        v = this.getInt64(i, littleEndian);
	        i += 8;
	        break;

	      case 'f':
	        v = this.getFloat32(i, littleEndian);
	        i += 4;
	        break;

	      case 'd':
	        v = this.getFloat64(i, littleEndian);
	        i += 8;
	        break;

	      case 'S':
	        [v, len] = this.getLongString(i, littleEndian);
	        i += len;
	        break;

	      case 'F':
	        [v, len] = this.getTable(i, littleEndian);
	        i += len;
	        break;

	      case 'A':
	        [v, len] = this.getArray(i, littleEndian);
	        i += len;
	        break;

	      case 'x':
	        [v, len] = this.getByteArray(i);
	        i += len;
	        break;

	      case 'T':
	        v = new Date(this.getInt64(i, littleEndian) * 1000);
	        i += 8;
	        break;

	      case 'V':
	        v = null;
	        break;

	      case 'D':
	        {
	          const scale = this.getUint8(i, littleEndian);
	          i += 1;
	          const value = this.getUint32(i, littleEndian);
	          i += 4;
	          v = value / 10 ** scale;
	          break;
	        }

	      default:
	        throw `Field type '${k}' not supported`;
	    }

	    return [v, i - byteOffset];
	  }

	  setField(byteOffset, field, littleEndian) {
	    let i = byteOffset;

	    switch (typeof field) {
	      case "string":
	        this.setUint8(i, 'S'.charCodeAt(), littleEndian);
	        i += 1;
	        i += this.setLongString(i, field, littleEndian);
	        break;

	      case "boolean":
	        this.setUint8(i, 't'.charCodeAt(), littleEndian);
	        i += 1;
	        this.setUint8(i, field ? 1 : 0, littleEndian);
	        i += 1;
	        break;

	      case "bigint":
	        this.setUint8(i, 'l'.charCodeAt(), littleEndian);
	        i += 1;
	        this.setBigInt64(i, field, littleEndian);
	        i += 8;
	        break;

	      case "number":
	        if (Number.isInteger(field)) {
	          if (-(2 ** 32) < field < 2 ** 32) {
	            this.setUint8(i, 'I'.charCodeAt(), littleEndian);
	            i += 1;
	            this.setInt32(i, field, littleEndian);
	            i += 4;
	          } else {
	            this.setUint8(i, 'l'.charCodeAt(), littleEndian);
	            i += 1;
	            this.setInt64(i, field, littleEndian);
	            i += 8;
	          }
	        } else {
	          // float
	          if (-(2 ** 32) < field < 2 ** 32) {
	            this.setUint8(i, 'f'.charCodeAt(), littleEndian);
	            i += 1;
	            this.setFloat32(i, field, littleEndian);
	            i += 4;
	          } else {
	            this.setUint8(i, 'd'.charCodeAt(), littleEndian);
	            i += 1;
	            this.setFloat64(i, field, littleEndian);
	            i += 8;
	          }
	        }

	        break;

	      case undefined:
	      case null:
	        this.setUint8(i, 'V'.charCodeAt(), littleEndian);
	        i += 1;
	        break;

	      case "object":
	        if (Array.isArray(field)) {
	          this.setUint8(i, 'A'.charCodeAt(), littleEndian);
	          i += 1;
	          i += this.setArray(i, field, littleEndian);
	        } else if (field instanceof ArrayBuffer || field instanceof Uint8Array) {
	          this.setUint8(i, 'x'.charCodeAt(), littleEndian);
	          i += 1;
	          i += this.setByteArray(i, field);
	        } else if (field instanceof Date) {
	          this.setUint8(i, 'T'.charCodeAt(), littleEndian);
	          i += 1;
	          const unixEpoch = Math.floor(Number(field) / 1000);
	          this.setInt64(i, unixEpoch, littleEndian);
	          i += 8;
	        } else {
	          // hopefully it's a hash like object
	          this.setUint8(i, 'F'.charCodeAt(), littleEndian);
	          i += 1;
	          i += this.setTable(i, field, littleEndian);
	        }

	        break;

	      default:
	        throw `Unsupported field type '${field}'`;
	    }

	    return i - byteOffset;
	  }

	  getArray(byteOffset, littleEndian) {
	    const len = this.getUint32(byteOffset, littleEndian);
	    byteOffset += 4;
	    const endOffset = byteOffset + len;
	    const v = [];

	    for (; byteOffset < endOffset;) {
	      const [field, fieldLen] = this.getField(byteOffset, littleEndian);
	      byteOffset += fieldLen;
	      v.push(field);
	    }

	    return [v, len + 4];
	  }

	  setArray(byteOffset, array, littleEndian) {
	    const start = byteOffset;
	    byteOffset += 4; // bytelength

	    array.forEach(e => {
	      byteOffset += this.setField(e);
	    });
	    this.setUint32(start, byteOffset - start - 4, littleEndian); // update length

	    return byteOffset - start;
	  }

	  getByteArray(byteOffset) {
	    const len = this.getUint32(byteOffset);
	    const v = new Uint8Array(this.buffer, byteOffset + 4, len);
	    return [v, len + 4];
	  }

	  setByteArray(byteOffset, data) {
	    const len = this.setUint32(byteOffset, data.byteLength);
	    const view = new Uint8Array(this.buffer, byteOffset + 4, len);
	    view.set(data);
	    return data.bytelength + 4;
	  }

	}

	class AMQPChannel {
	  constructor(connection, id) {
	    this.promises = [];
	    this.connection = connection;
	    this.id = id;
	    this.consumers = {};
	    this.closed = false;
	  }

	  resolvePromise(value) {
	    if (this.promises.length === 0) return false;
	    const [resolve] = this.promises.shift();
	    resolve(value);
	    return true;
	  }

	  rejectPromise(err) {
	    if (this.promises.length === 0) return false;
	    const [, reject] = this.promises.shift();
	    reject(err);
	    return true;
	  }

	  sendRpc(frame, frameSize) {
	    return new Promise((resolve, reject) => {
	      this.connection.send(new Uint8Array(frame.buffer, 0, frameSize)).then(() => this.promises.push([resolve, reject])).catch(reject);
	    });
	  }

	  setClosed(err) {
	    if (!this.closed) {
	      this.closed = true; // Close all consumers

	      Object.values(this.consumers).forEach(consumer => consumer.setClosed(err));
	      this.consumers = []; // Empty consumers
	      // Empty and reject all RPC promises

	      while (this.rejectPromise(err)) {
	      }
	    }
	  }

	  rejectClosed() {
	    return Promise.reject(new AMQPError("Channel is closed", this.connection));
	  }

	  close({
	    code = 200,
	    reason = ""
	  } = {}) {
	    if (this.closed) return this.rejectClosed();
	    this.closed = true;
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(512));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel

	    frame.setUint32(j, 0);
	    j += 4; // frameSize

	    frame.setUint16(j, 20);
	    j += 2; // class: channel

	    frame.setUint16(j, 40);
	    j += 2; // method: close

	    frame.setUint16(j, code);
	    j += 2; // reply code

	    j += frame.setShortString(j, reason); // reply reason

	    frame.setUint16(j, 0);
	    j += 2; // failing-class-id

	    frame.setUint16(j, 0);
	    j += 2; // failing-method-id

	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    frame.setUint32(3, j - 8); // update frameSize

	    return this.sendRpc(frame, j);
	  } // Message is ready to be delivered to consumer


	  deliver(msg) {
	    queueMicrotask(() => {
	      // Enqueue microtask to avoid race condition with ConsumeOk
	      const consumer = this.consumers[msg.consumerTag];

	      if (consumer) {
	        consumer.onMessage(msg);
	      } else {
	        console.error("Consumer", msg.consumerTag, "on channel", this.id, "doesn't exists");
	      }
	    });
	  }

	  queueBind(queue, exchange, routingKey, args = {}) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const bind = new AMQPView(new ArrayBuffer(4096));
	    bind.setUint8(j, 1);
	    j += 1; // type: method

	    bind.setUint16(j, this.id);
	    j += 2; // channel: 1

	    bind.setUint32(j, 0);
	    j += 4; // frameSize

	    bind.setUint16(j, 50);
	    j += 2; // class: queue

	    bind.setUint16(j, 20);
	    j += 2; // method: bind

	    bind.setUint16(j, 0);
	    j += 2; // reserved1

	    j += bind.setShortString(j, queue);
	    j += bind.setShortString(j, exchange);
	    j += bind.setShortString(j, routingKey);
	    bind.setUint8(j, 0);
	    j += 1; // noWait

	    j += bind.setTable(j, args);
	    bind.setUint8(j, 206);
	    j += 1; // frame end byte

	    bind.setUint32(3, j - 8); // update frameSize

	    return this.sendRpc(bind, j);
	  }

	  queueUnbind(queue, exchange, routingKey, args = {}) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const unbind = new AMQPView(new ArrayBuffer(4096));
	    unbind.setUint8(j, 1);
	    j += 1; // type: method

	    unbind.setUint16(j, this.id);
	    j += 2; // channel: 1

	    unbind.setUint32(j, 0);
	    j += 4; // frameSize

	    unbind.setUint16(j, 50);
	    j += 2; // class: queue

	    unbind.setUint16(j, 50);
	    j += 2; // method: unbind

	    unbind.setUint16(j, 0);
	    j += 2; // reserved1

	    j += unbind.setShortString(j, queue);
	    j += unbind.setShortString(j, exchange);
	    j += unbind.setShortString(j, routingKey);
	    j += unbind.setTable(j, args);
	    unbind.setUint8(j, 206);
	    j += 1; // frame end byte

	    unbind.setUint32(3, j - 8); // update frameSize

	    return this.sendRpc(unbind, j);
	  }

	  queuePurge(queue) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const purge = new AMQPView(new ArrayBuffer(512));
	    purge.setUint8(j, 1);
	    j += 1; // type: method

	    purge.setUint16(j, this.id);
	    j += 2; // channel: 1

	    purge.setUint32(j, 0);
	    j += 4; // frameSize

	    purge.setUint16(j, 50);
	    j += 2; // class: queue

	    purge.setUint16(j, 30);
	    j += 2; // method: purge

	    purge.setUint16(j, 0);
	    j += 2; // reserved1

	    j += purge.setShortString(j, queue);
	    purge.setUint8(j, 1 );
	    j += 1; // noWait

	    purge.setUint8(j, 206);
	    j += 1; // frame end byte

	    purge.setUint32(3, j - 8); // update frameSize

	    return this.sendRpc(purge, j);
	  }

	  queueDeclare(name = "", {
	    passive = false,
	    durable = name !== "",
	    autoDelete = name === "",
	    exclusive = name === "",
	    args = {}
	  } = {}) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const declare = new AMQPView(new ArrayBuffer(4096));
	    declare.setUint8(j, 1);
	    j += 1; // type: method

	    declare.setUint16(j, this.id);
	    j += 2; // channel: 1

	    declare.setUint32(j, 0);
	    j += 4; // frameSize

	    declare.setUint16(j, 50);
	    j += 2; // class: queue

	    declare.setUint16(j, 10);
	    j += 2; // method: declare

	    declare.setUint16(j, 0);
	    j += 2; // reserved1

	    j += declare.setShortString(j, name); // name

	    let bits = 0;
	    if (passive) bits = bits | 1 << 0;
	    if (durable) bits = bits | 1 << 1;
	    if (exclusive) bits = bits | 1 << 2;
	    if (autoDelete) bits = bits | 1 << 3;
	    declare.setUint8(j, bits);
	    j += 1;
	    j += declare.setTable(j, args); // arguments

	    declare.setUint8(j, 206);
	    j += 1; // frame end byte

	    declare.setUint32(3, j - 8); // update frameSize

	    return this.sendRpc(declare, j);
	  }

	  queueDelete(name = "", {
	    ifUnused = false,
	    ifEmpty = false
	  } = {}) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(512));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel: 1

	    frame.setUint32(j, 0);
	    j += 4; // frameSize

	    frame.setUint16(j, 50);
	    j += 2; // class: queue

	    frame.setUint16(j, 40);
	    j += 2; // method: delete

	    frame.setUint16(j, 0);
	    j += 2; // reserved1

	    j += frame.setShortString(j, name); // name

	    let bits = 0;
	    if (ifUnused) bits = bits | 1 << 0;
	    if (ifEmpty) bits = bits | 1 << 1;
	    frame.setUint8(j, bits);
	    j += 1;
	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    frame.setUint32(3, j - 8); // update frameSize

	    return this.sendRpc(frame, j);
	  }

	  basicQos(prefetchCount, prefetchSize = 0, global = false) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(19));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel: 1

	    frame.setUint32(j, 11);
	    j += 4; // frameSize

	    frame.setUint16(j, 60);
	    j += 2; // class: basic

	    frame.setUint16(j, 10);
	    j += 2; // method: qos

	    frame.setUint32(j, prefetchSize);
	    j += 4; // prefetch size

	    frame.setUint16(j, prefetchCount);
	    j += 2; // prefetch count

	    frame.setUint8(j, global ? 1 : 0);
	    j += 1; // glocal

	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    return this.sendRpc(frame, j);
	  }

	  basicConsume(queue, {
	    tag = "",
	    noAck = true,
	    exclusive = false,
	    args = {}
	  } = {}, callback) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(4096));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel: 1

	    frame.setUint32(j, 0);
	    j += 4; // frameSize

	    frame.setUint16(j, 60);
	    j += 2; // class: basic

	    frame.setUint16(j, 20);
	    j += 2; // method: consume

	    frame.setUint16(j, 0);
	    j += 2; // reserved1

	    j += frame.setShortString(j, queue); // queue

	    j += frame.setShortString(j, tag); // tag

	    let bits = 0;
	    if (noAck) bits = bits | 1 << 1;
	    if (exclusive) bits = bits | 1 << 2;
	    frame.setUint8(j, bits);
	    j += 1; // noLocal/noAck/exclusive/noWait

	    j += frame.setTable(j, args); // arguments table

	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    frame.setUint32(3, j - 8); // update frameSize

	    return new Promise((resolve, reject) => {
	      this.sendRpc(frame, j).then(consumerTag => {
	        const consumer = new AMQPConsumer(this, consumerTag, callback);
	        this.consumers[consumerTag] = consumer;
	        resolve(consumer);
	      }).catch(reject);
	    });
	  }

	  basicCancel(tag) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(512));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel: 1

	    frame.setUint32(j, 0);
	    j += 4; // frameSize

	    frame.setUint16(j, 60);
	    j += 2; // class: basic

	    frame.setUint16(j, 30);
	    j += 2; // method: cancel

	    j += frame.setShortString(j, tag); // tag

	    frame.setUint8(j, 0);
	    j += 1; // noWait

	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    frame.setUint32(3, j - 8); // update frameSize

	    return new Promise((resolve, reject) => {
	      this.sendRpc(frame, j).then(consumerTag => {
	        const consumer = this.consumers[consumerTag];
	        consumer.setClosed();
	        delete this.consumers[consumerTag];
	        resolve(this);
	      }).catch(reject);
	    });
	  }

	  basicAck(deliveryTag, multiple = false) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(21));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel

	    frame.setUint32(j, 13);
	    j += 4; // frameSize

	    frame.setUint16(j, 60);
	    j += 2; // class: basic

	    frame.setUint16(j, 80);
	    j += 2; // method: ack

	    frame.setUint64(j, deliveryTag);
	    j += 8;
	    frame.setUint8(j, multiple ? 1 : 0);
	    j += 1;
	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    return this.connection.send(new Uint8Array(frame.buffer, 0, 21));
	  }

	  basicReject(deliveryTag, requeue = false) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(21));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel

	    frame.setUint32(j, 13);
	    j += 4; // frameSize

	    frame.setUint16(j, 60);
	    j += 2; // class: basic

	    frame.setUint16(j, 90);
	    j += 2; // method: reject

	    frame.setUint64(j, deliveryTag);
	    j += 8;
	    frame.setUint8(j, requeue ? 1 : 0);
	    j += 1;
	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    return this.connection.send(new Uint8Array(frame.buffer, 0, 21));
	  }

	  basicNack(deliveryTag, requeue = false, multiple = false) {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(21));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel

	    frame.setUint32(j, 13);
	    j += 4; // frameSize

	    frame.setUint16(j, 60);
	    j += 2; // class: basic

	    frame.setUint16(j, 120);
	    j += 2; // method: nack

	    frame.setUint64(j, deliveryTag);
	    j += 8;
	    let bits = 0;
	    if (multiple) bits = bits | 1 << 0;
	    if (requeue) bits = bits | 1 << 1;
	    frame.setUint8(j, bits);
	    j += 1;
	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    return this.connection.send(new Uint8Array(frame.buffer, 0, 21));
	  }

	  basicPublish(exchange, routingkey, data, properties) {
	    if (this.closed) return this.rejectClosed();

	    if (data instanceof Uint8Array) ; else if (data instanceof ArrayBuffer) {
	      data = new Uint8Array(data);
	    } else if (typeof data === "string") {
	      const encoder = new TextEncoder();
	      data = encoder.encode(data);
	    } else {
	      const json = JSON.stringify(data);
	      const encoder = new TextEncoder();
	      data = encoder.encode(json);
	    }

	    const promises = [];
	    let j = 0;
	    let buffer = new AMQPView(new ArrayBuffer(4096));
	    buffer.setUint8(j, 1);
	    j += 1; // type: method

	    buffer.setUint16(j, this.id);
	    j += 2; // channel

	    j += 4; // frame size, update later

	    buffer.setUint16(j, 60);
	    j += 2; // class: basic

	    buffer.setUint16(j, 40);
	    j += 2; // method: publish

	    buffer.setUint16(j, 0);
	    j += 2; // reserved1

	    j += buffer.setShortString(j, exchange); // exchange

	    j += buffer.setShortString(j, routingkey); // routing key

	    buffer.setUint8(j, 0);
	    j += 1; // mandatory/immediate

	    buffer.setUint8(j, 206);
	    j += 1; // frame end byte

	    buffer.setUint32(3, j - 8); // update frameSize

	    const headerStart = j;
	    buffer.setUint8(j, 2);
	    j += 1; // type: header

	    buffer.setUint16(j, this.id);
	    j += 2; // channel

	    j += 4; // frame size, update later

	    buffer.setUint16(j, 60);
	    j += 2; // class: basic

	    buffer.setUint16(j, 0);
	    j += 2; // weight

	    buffer.setUint32(j, 0);
	    j += 4; // bodysize (upper 32 of 64 bits)

	    buffer.setUint32(j, data.byteLength);
	    j += 4; // bodysize

	    j += buffer.setProperties(j, properties); // properties

	    buffer.setUint8(j, 206);
	    j += 1; // frame end byte

	    buffer.setUint32(headerStart + 3, j - headerStart - 8); // update frameSize
	    // Send current frames if there's no body to send

	    if (data.byteLength === 0) {
	      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j));
	      promises.push(p);
	      return;
	    } // Send current frames if a body frame can't fit in the rest of the frame buffer


	    if (j >= 4096 - 8) {
	      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j));
	      promises.push(p);
	      j = 0;
	    } // split body into multiple frames if body > frameMax


	    for (let bodyPos = 0; bodyPos < data.byteLength;) {
	      const frameSize = Math.min(data.byteLength - bodyPos, 4096 - 8 - j); // frame overhead is 8 bytes

	      const dataSlice = new Uint8Array(data.buffer, bodyPos, frameSize);
	      if (j === 0) buffer = new AMQPView(new ArrayBuffer(frameSize + 8));
	      buffer.setUint8(j, 3);
	      j += 1; // type: body

	      buffer.setUint16(j, this.id);
	      j += 2; // channel

	      buffer.setUint32(j, frameSize);
	      j += 4; // frameSize

	      const bodyView = new Uint8Array(buffer.buffer, j, frameSize);
	      bodyView.set(dataSlice);
	      j += frameSize; // body content

	      buffer.setUint8(j, 206);
	      j += 1; // frame end byte

	      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j));
	      promises.push(p);
	      bodyPos += frameSize;
	      j = 0;
	    }

	    return Promise.all(promises);
	  }

	  confirmSelect() {
	    if (this.closed) return this.rejectClosed();
	    let j = 0;
	    let frame = new AMQPView(new ArrayBuffer(13));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, this.id);
	    j += 2; // channel

	    frame.setUint32(j, 5); // frame size

	    frame.setUint16(j, 85);
	    j += 2; // class: confirm

	    frame.setUint16(j, 10);
	    j += 2; // method: select

	    frame.setUint8(j, 0);
	    j += 1; // no wait

	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    return this.sendRpc(frame, j);
	  }

	  queue(name = "", props = {}) {
	    return new Promise((resolve, reject) => {
	      this.queueDeclare(name, props).then(({
	        name
	      }) => resolve(new AMQPQueue(this, name))).catch(reject);
	    });
	  }

	  prefetch(prefetchCount) {
	    return this.basicQos(prefetchCount);
	  }

	}

	class AMQPMessage {
	  constructor(channel) {
	    this.channel = channel;
	  }

	  bodyToString() {
	    const decoder = new TextDecoder();
	    return decoder.decode(this.body);
	  }
	  /** Alias for bodyToString()
	  */


	  bodyString() {
	    return this.bodyToString();
	  }

	  ack(multiple = false) {
	    return this.channel.basicAck(this.deliveryTag, multiple);
	  }

	  reject(requeue = false) {
	    return this.channel.basicReject(this.deliveryTag, requeue);
	  }

	  nack(requeue = false, multiple = false) {
	    return this.channel.basicNack(this.deliveryTag, requeue, multiple);
	  }

	}

	var version = "1.0.5";

	class AMQPBaseClient {
	  constructor(vhost, username, password, name, platform) {
	    this.vhost = vhost;
	    this.username = username;
	    Object.defineProperty(this, 'password', {
	      value: password,
	      enumerable: false // hide it from console.log etc.

	    });
	    this.name = name; // connection name

	    this.platform = platform;
	    this.channels = [new AMQPChannel(this, 0)];
	    this.closed = false;
	  }

	  connect() {
	    throw "Abstract method not implemented";
	  }

	  send() {
	    throw "Abstract method not implemented";
	  }

	  closeSocket() {
	    throw "Abstract method not implemented";
	  }

	  rejectClosed() {
	    return Promise.reject(new AMQPError("Connection closed", this));
	  }

	  close({
	    code = 200,
	    reason = ""
	  } = {}) {
	    if (this.closed) return this.rejectClosed();
	    this.closed = true;
	    let j = 0;
	    const frame = new AMQPView(new ArrayBuffer(512));
	    frame.setUint8(j, 1);
	    j += 1; // type: method

	    frame.setUint16(j, 0);
	    j += 2; // channel: 0

	    frame.setUint32(j, 0);
	    j += 4; // frameSize

	    frame.setUint16(j, 10);
	    j += 2; // class: connection

	    frame.setUint16(j, 50);
	    j += 2; // method: close

	    frame.setUint16(j, code);
	    j += 2; // reply code

	    j += frame.setShortString(j, reason); // reply reason

	    frame.setUint16(j, 0);
	    j += 2; // failing-class-id

	    frame.setUint16(j, 0);
	    j += 2; // failing-method-id

	    frame.setUint8(j, 206);
	    j += 1; // frame end byte

	    frame.setUint32(3, j - 8); // update frameSize

	    return new Promise((resolve, reject) => {
	      this.send(new Uint8Array(frame.buffer, 0, j)).then(() => this.closePromise = [resolve, reject]).catch(reject);
	    });
	  }

	  channel(id) {
	    if (this.closed) return this.rejectClosed(); // Store channels in an array, set position to null when channel is closed
	    // Look for first null value or add one the end

	    if (!id) id = this.channels.findIndex(ch => ch === undefined);
	    if (id === -1) id = this.channels.length;
	    const channel = new AMQPChannel(this, id);
	    this.channels[id] = channel;
	    let j = 0;
	    const channelOpen = new AMQPView(new ArrayBuffer(13));
	    channelOpen.setUint8(j, 1);
	    j += 1; // type: method

	    channelOpen.setUint16(j, id);
	    j += 2; // channel id

	    channelOpen.setUint32(j, 5);
	    j += 4; // frameSize

	    channelOpen.setUint16(j, 20);
	    j += 2; // class: channel

	    channelOpen.setUint16(j, 10);
	    j += 2; // method: open

	    channelOpen.setUint8(j, 0);
	    j += 1; // reserved1

	    channelOpen.setUint8(j, 206);
	    j += 1; // frame end byte

	    return new Promise((resolve, reject) => {
	      this.send(channelOpen.buffer).then(() => channel.promises.push([resolve, reject])).catch(reject);
	    });
	  }

	  parseFrames(view) {
	    // Can possibly be multiple AMQP frames in a single WS frame
	    for (let i = 0; i < view.byteLength;) {
	      let j = 0; // position in outgoing frame

	      const type = view.getUint8(i);
	      i += 1;
	      const channelId = view.getUint16(i);
	      i += 2;
	      const frameSize = view.getUint32(i);
	      i += 4;

	      switch (type) {
	        case 1:
	          {
	            // method
	            const classId = view.getUint16(i);
	            i += 2;
	            const methodId = view.getUint16(i);
	            i += 2;

	            switch (classId) {
	              case 10:
	                {
	                  // connection
	                  switch (methodId) {
	                    case 10:
	                      {
	                        // start
	                        // ignore start frame, just reply startok
	                        i += frameSize - 4;
	                        const startOk = new AMQPView(new ArrayBuffer(4096));
	                        startOk.setUint8(j, 1);
	                        j += 1; // type: method

	                        startOk.setUint16(j, 0);
	                        j += 2; // channel: 0

	                        startOk.setUint32(j, 0);
	                        j += 4; // frameSize: to be updated

	                        startOk.setUint16(j, 10);
	                        j += 2; // class: connection

	                        startOk.setUint16(j, 11);
	                        j += 2; // method: startok

	                        const clientProps = {
	                          connection_name: this.name,
	                          product: "amqp-client.js",
	                          information: "https://github.com/cloudamqp/amqp-client.js",
	                          version: version,
	                          platform: this.platform,
	                          capabilities: {
	                            "authentication_failure_close": true,
	                            "basic.nack": true,
	                            "connection.blocked": false,
	                            "consumer_cancel_notify": true,
	                            "exchange_exchange_bindings": true,
	                            "per_consumer_qos": true,
	                            "publisher_confirms": true
	                          }
	                        };
	                        if (!this.name) delete clientProps["connection_name"];
	                        j += startOk.setTable(j, clientProps); // client properties

	                        j += startOk.setShortString(j, "PLAIN"); // mechanism

	                        const response = `\u0000${this.username}\u0000${this.password}`;
	                        j += startOk.setLongString(j, response); // response

	                        j += startOk.setShortString(j, ""); // locale

	                        startOk.setUint8(j, 206);
	                        j += 1; // frame end byte

	                        startOk.setUint32(3, j - 8); // update frameSize

	                        this.send(new Uint8Array(startOk.buffer, 0, j));
	                        break;
	                      }

	                    case 30:
	                      {
	                        // tune
	                        const channelMax = view.getUint16(i);
	                        i += 2;
	                        const frameMax = view.getUint32(i);
	                        i += 4;
	                        const heartbeat = view.getUint16(i);
	                        i += 2;
	                        this.channelMax = channelMax;
	                        this.frameMax = Math.min(4096, frameMax);
	                        this.heartbeat = Math.min(0, heartbeat);
	                        const tuneOk = new AMQPView(new ArrayBuffer(20));
	                        tuneOk.setUint8(j, 1);
	                        j += 1; // type: method

	                        tuneOk.setUint16(j, 0);
	                        j += 2; // channel: 0

	                        tuneOk.setUint32(j, 12);
	                        j += 4; // frameSize: 12

	                        tuneOk.setUint16(j, 10);
	                        j += 2; // class: connection

	                        tuneOk.setUint16(j, 31);
	                        j += 2; // method: tuneok

	                        tuneOk.setUint16(j, this.channelMax);
	                        j += 2; // channel max

	                        tuneOk.setUint32(j, this.frameMax);
	                        j += 4; // frame max

	                        tuneOk.setUint16(j, this.heartbeat);
	                        j += 2; // heartbeat

	                        tuneOk.setUint8(j, 206);
	                        j += 1; // frame end byte

	                        this.send(new Uint8Array(tuneOk.buffer, 0, j));
	                        j = 0;
	                        const open = new AMQPView(new ArrayBuffer(512));
	                        open.setUint8(j, 1);
	                        j += 1; // type: method

	                        open.setUint16(j, 0);
	                        j += 2; // channel: 0

	                        open.setUint32(j, 0);
	                        j += 4; // frameSize: to be updated

	                        open.setUint16(j, 10);
	                        j += 2; // class: connection

	                        open.setUint16(j, 40);
	                        j += 2; // method: open

	                        j += open.setShortString(j, this.vhost); // vhost

	                        open.setUint8(j, 0);
	                        j += 1; // reserved1

	                        open.setUint8(j, 0);
	                        j += 1; // reserved2

	                        open.setUint8(j, 206);
	                        j += 1; // frame end byte

	                        open.setUint32(3, j - 8); // update frameSize

	                        this.send(new Uint8Array(open.buffer, 0, j));
	                        break;
	                      }

	                    case 41:
	                      {
	                        // openok
	                        i += 1; // reserved1

	                        const [resolve] = this.connectPromise;
	                        delete this.connectPromise;
	                        resolve(this);
	                        break;
	                      }

	                    case 50:
	                      {
	                        // close
	                        const code = view.getUint16(i);
	                        i += 2;
	                        const [text, strLen] = view.getShortString(i);
	                        i += strLen;
	                        const classId = view.getUint16(i);
	                        i += 2;
	                        const methodId = view.getUint16(i);
	                        i += 2;
	                        console.debug("connection closed by server", code, text, classId, methodId);
	                        const closeOk = new AMQPView(new ArrayBuffer(12));
	                        closeOk.setUint8(j, 1);
	                        j += 1; // type: method

	                        closeOk.setUint16(j, 0);
	                        j += 2; // channel: 0

	                        closeOk.setUint32(j, 4);
	                        j += 4; // frameSize

	                        closeOk.setUint16(j, 10);
	                        j += 2; // class: connection

	                        closeOk.setUint16(j, 51);
	                        j += 2; // method: closeok

	                        closeOk.setUint8(j, 206);
	                        j += 1; // frame end byte

	                        this.send(new Uint8Array(closeOk.buffer, 0, j));
	                        const msg = `connection closed: ${text} (${code})`;
	                        const err = new AMQPError(msg, this);
	                        this.channels.forEach(ch => ch.setClosed(err));
	                        this.channels = []; // if closed while connecting

	                        const [, reject] = this.connectPromise;
	                        if (reject) reject(err);
	                        delete this.connectPromise;
	                        this.closeSocket();
	                        break;
	                      }

	                    case 51:
	                      {
	                        // closeOk
	                        this.channels.forEach(ch => ch.setClosed());
	                        this.channels = [];
	                        const [resolve] = this.closePromise;
	                        resolve();
	                        delete this.closePromise;
	                        this.closeSocket();
	                        break;
	                      }

	                    default:
	                      i += frameSize - 4;
	                      console.error("unsupported class/method id", classId, methodId);
	                  }

	                  break;
	                }

	              case 20:
	                {
	                  // channel
	                  switch (methodId) {
	                    case 11:
	                      {
	                        // openok
	                        i += 4; // reserved1 (long string)

	                        const channel = this.channels[channelId];
	                        channel.resolvePromise(channel);
	                        break;
	                      }

	                    case 40:
	                      {
	                        // close
	                        const code = view.getUint16(i);
	                        i += 2;
	                        const [text, strLen] = view.getShortString(i);
	                        i += strLen;
	                        const classId = view.getUint16(i);
	                        i += 2;
	                        const methodId = view.getUint16(i);
	                        i += 2;
	                        console.debug("channel", channelId, "closed", code, text, classId, methodId);
	                        const closeOk = new AMQPView(new ArrayBuffer(12));
	                        closeOk.setUint8(j, 1);
	                        j += 1; // type: method

	                        closeOk.setUint16(j, channelId);
	                        j += 2; // channel

	                        closeOk.setUint32(j, 4);
	                        j += 4; // frameSize

	                        closeOk.setUint16(j, 20);
	                        j += 2; // class: channel

	                        closeOk.setUint16(j, 41);
	                        j += 2; // method: closeok

	                        closeOk.setUint8(j, 206);
	                        j += 1; // frame end byte

	                        this.send(new Uint8Array(closeOk.buffer, 0, j));
	                        const channel = this.channels[channelId];

	                        if (channel) {
	                          const msg = `channel ${channelId} closed: ${text} (${code})`;
	                          const err = new AMQPError(msg, this);
	                          channel.setClosed(err);
	                          delete this.channels[channelId];
	                        } else {
	                          console.warn("channel", channelId, "already closed");
	                        }

	                        break;
	                      }

	                    case 41:
	                      {
	                        // closeOk
	                        const channel = this.channels[channelId];

	                        if (channel) {
	                          channel.setClosed();
	                          delete this.channels[channelId];
	                          channel.resolvePromise();
	                        } else {
	                          this.rejectPromise(`channel ${channelId} already closed`);
	                        }

	                        break;
	                      }

	                    default:
	                      i += frameSize - 4; // skip rest of frame

	                      console.error("unsupported class/method id", classId, methodId);
	                  }

	                  break;
	                }

	              case 50:
	                {
	                  // queue
	                  switch (methodId) {
	                    case 11:
	                      {
	                        // declareOk
	                        const [name, strLen] = view.getShortString(i);
	                        i += strLen;
	                        const messageCount = view.getUint32(i);
	                        i += 4;
	                        const consumerCount = view.getUint32(i);
	                        i += 4;
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise({
	                          name,
	                          messageCount,
	                          consumerCount
	                        });
	                        break;
	                      }

	                    case 21:
	                      {
	                        // bindOk
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise();
	                        break;
	                      }

	                    case 31:
	                      {
	                        // purgeOk
	                        const messageCount = view.getUint32(i);
	                        i += 4;
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise({
	                          messageCount
	                        });
	                        break;
	                      }

	                    case 41:
	                      {
	                        // deleteOk
	                        const messageCount = view.getUint32(i);
	                        i += 4;
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise({
	                          messageCount
	                        });
	                        break;
	                      }

	                    case 51:
	                      {
	                        // unbindOk
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise();
	                        break;
	                      }

	                    default:
	                      i += frameSize - 4;
	                      console.error("unsupported class/method id", classId, methodId);
	                  }

	                  break;
	                }

	              case 60:
	                {
	                  // basic
	                  switch (methodId) {
	                    case 11:
	                      {
	                        // qosOk
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise();
	                        break;
	                      }

	                    case 21:
	                      {
	                        // consumeOk
	                        const [consumerTag, len] = view.getShortString(i);
	                        i += len;
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise(consumerTag);
	                        break;
	                      }

	                    case 31:
	                      {
	                        // cancelOk
	                        const [consumerTag, len] = view.getShortString(i);
	                        i += len;
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise(consumerTag);
	                        break;
	                      }

	                    case 60:
	                      {
	                        // deliver
	                        const [consumerTag, consumerTagLen] = view.getShortString(i);
	                        i += consumerTagLen;
	                        const deliveryTag = view.getUint64(i);
	                        i += 8;
	                        const redelivered = view.getUint8(i) === 1;
	                        i += 1;
	                        const [exchange, exchangeLen] = view.getShortString(i);
	                        i += exchangeLen;
	                        const [routingKey, routingKeyLen] = view.getShortString(i);
	                        i += routingKeyLen;
	                        const channel = this.channels[channelId];

	                        if (!channel) {
	                          console.warn("Cannot deliver to closed channel", channelId);
	                          return;
	                        }

	                        const message = new AMQPMessage(channel);
	                        message.consumerTag = consumerTag;
	                        message.deliveryTag = deliveryTag;
	                        message.exchange = exchange;
	                        message.routingKey = routingKey;
	                        message.redelivered = redelivered;
	                        channel.delivery = message;
	                        break;
	                      }

	                    default:
	                      i += frameSize - 4;
	                      console.error("unsupported class/method id", classId, methodId);
	                  }

	                  break;
	                }

	              case 85:
	                {
	                  // confirm
	                  switch (methodId) {
	                    case 11:
	                      {
	                        // selectOk
	                        const channel = this.channels[channelId];
	                        channel.resolvePromise();
	                        break;
	                      }
	                  }

	                  break;
	                }

	              default:
	                i += frameSize - 2;
	                console.error("unsupported class id", classId);
	            }

	            break;
	          }

	        case 2:
	          {
	            // header
	            i += 2; // ignoring class id

	            i += 2; // ignoring weight

	            const bodySize = view.getUint64(i);
	            i += 8;
	            const [properties, propLen] = view.getProperties(i);
	            i += propLen;
	            const channel = this.channels[channelId];

	            if (!channel) {
	              console.warn("Cannot deliver to closed channel", channelId);
	              break;
	            }

	            const delivery = channel.delivery;
	            delivery.bodySize = bodySize;
	            delivery.properties = properties;
	            delivery.body = new Uint8Array(bodySize);
	            delivery.bodyPos = 0; // if body is split over multiple frames

	            if (bodySize === 0) channel.deliver();
	            break;
	          }

	        case 3:
	          {
	            // body
	            const channel = this.channels[channelId];

	            if (!channel) {
	              console.warn("Cannot deliver to closed channel", channelId);
	              i += frameSize;
	              break;
	            }

	            const delivery = channel.delivery;
	            const bodyPart = new Uint8Array(view.buffer, i, frameSize);
	            delivery.body.set(bodyPart, delivery.bodyPos);
	            delivery.bodyPos += frameSize;
	            i += frameSize;
	            if (delivery.bodyPos === delivery.bodySize) channel.deliver();
	            break;
	          }

	        case 8:
	          {
	            // heartbeat
	            const heartbeat = new AMQPView(new ArrayBuffer(8));
	            heartbeat.setUint8(j, 1);
	            j += 1; // type: method

	            heartbeat.setUint16(j, 0);
	            j += 2; // channel: 0

	            heartbeat.setUint32(j, 0);
	            j += 4; // frameSize

	            heartbeat.setUint8(j, 206);
	            j += 1; // frame end byte

	            this.send(new Uint8Array(heartbeat.buffer, 0, j));
	            break;
	          }

	        default:
	          console.error("invalid frame type:", type);
	          i += frameSize;
	      }

	      const frameEnd = view.getUint8(i);
	      i += 1;
	      if (frameEnd != 206) console.error("Invalid frame end", frameEnd);
	    }
	  }

	}

	class AMQPWebSocketClient extends AMQPBaseClient {
	  constructor(url, vhost = "/", username = "guest", password = "guest", name = undefined) {
	    super(vhost, username, password, name, window.navigator.userAgent);
	    this.url = url;
	  }

	  connect() {
	    const socket = new WebSocket(this.url);
	    this.socket = socket;
	    socket.binaryType = "arraybuffer";

	    socket.onmessage = event => this.parseFrames(new AMQPView(event.data));

	    return new Promise((resolve, reject) => {
	      this.connectPromise = [resolve, reject];
	      socket.onclose = reject;
	      socket.onerror = reject;

	      socket.onopen = () => {
	        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]);
	        socket.send(amqpstart);
	      };
	    });
	  }

	  send(bytes) {
	    return new Promise((resolve, reject) => {
	      try {
	        this.socket.send(bytes);
	        resolve();
	      } catch (err) {
	        reject(err);
	      }
	    });
	  }

	  closeSocket() {
	    this.socket.close();
	  }

	}

	return AMQPWebSocketClient;

}());
