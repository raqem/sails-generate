/**
 * Module dependencies
 * @type {Object}
 */
var util = require('util');
var _ = require('./_');
var async = require('async');
var path = require('path');
var pathRegexp = require('./util').pathRegexp;


var rootGenerator = require('./rootGenerator');
var rootScope = require('./rootScope');
var generateTarget = require('./target');


/**
 * Run a generator given an existing scope.
 * 
 * @param  {Object} Generator
 * @param  {Object} scope
 * @param  {Switchback} sb
 */
function generate (Generator, scope, sb) {

	// Merge with root scope
	_.defaultsDeep(scope, rootScope);

	// TODO: validate args more thoroughly
	if ( !_.isArray(scope.args) ) {
		return sb(new Error('Invalid `scope.args` passed to generator: '+util.inspect(scope.args)));
	}

	// Ensure that `rootPath` exists
	// TODO: Ensure that `rootPath` is reasonable
	// (i.e. within highest acceptable path-- prevents accidental smashing of file-system, etc.)
	if (!scope.rootPath) {
		return cb(new Error('Invalid `scope.rootPath` passed to generator: ' + util.inspect(scope.rootPath)));
	}

	// Alias first handful of arguments on scope object
	// for easy access and use as :params in `targets` keys
	_.defaults(scope, {
		arg0: scope.args[0],
		arg1: scope.args[1],
		arg2: scope.args[2],
		arg3: scope.args[3]
	});

	// Resolve string shorthand for generator defs
	// to `{ generator: 'originalDef' }`
	if (typeof Generator === 'string') {
		var generatorName = Generator;
		Generator = { generator: generatorName };
	}

	// Merge with root generator
	_.defaultsDeep(Generator, rootGenerator);

	// Run the generator's bootstrap before proceeding
	Generator.bootstrap(scope, function (err) {
		if (err) return sb(err);

		// Emit output
		// scope.output.push('Generating ' + util.inspect(Generator) + ' at ' + scope.rootPath+ '...');

		// Process all of the generator's targets concurrently
		async.each(Object.keys(Generator.targets), function (keyPath, cb) {

			// Create a new scope object for this target,
			// with references to the important bits of the original.
			// (depth will be passed-by-value, but that's what we want)
			// 
			// Then generate the target, passing along a reference to
			// the base `generate` method to allow for recursive generators.
			var target = Generator.targets[keyPath];
			if (!target) return cb(new Error('Generator error: Invalid target: {"'+keyPath+'": '+util.inspect(target)+'}'));

			// Input tolerance
			if (keyPath === '') keyPath = '.';

			// Interpret `keyPath` using express's parameterized route conventions,
			// first parsing params, then replacing them with their proper values from scope.
			var params = [];
			pathRegexp(keyPath, params);
			var err;
			var parsedKeyPath = _.reduce(params, function (keyPath, param) {
				try {
					var paramMatchExpr = ':'+param.name;
					var actualParamValue = scope[param.name];
					if (!actualParamValue) {
						err = new Error('Generator error: Unknown value "'+param.name+'" in scope. (target: `'+keyPath+'`)');
						return false;
					}
					actualParamValue = String(actualParamValue);

					return keyPath.replace(paramMatchExpr, actualParamValue);
				}
				catch(e) {
					err = new Error('Generator error: Could not parse target key: '+keyPath);
					return false;
				}
			}, keyPath);
			if (!parsedKeyPath) return cb(err);


			// Run target generator/helper
			generateTarget({
				target: target,

				// Create path from `rootPath` to `keyPath` to use as the `rootPath`
				// for any generators or helpers in this target.
				// (use a copy so that child generators don't mutate the scope)
				scope: _.merge({}, scope,{
					rootPath: path.resolve(scope.rootPath, parsedKeyPath),
					// Include reference to original keypath for error reporting
					keyPath: keyPath
				}),
				recursiveGenerate: generate,
				cb: cb
			});

		}, function done (err) {
			if (err) return sb(err, scope.output);
			// Run any deferred output fns in `scope.output`
			return sb(err, _.map(scope.output, function(item){
				if (typeof item === 'function') return item(scope);
				return item;
			}));
		});
	});
}


module.exports = generate;