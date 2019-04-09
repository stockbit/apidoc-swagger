var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');

var swagger = {
	swagger : "2.0",
	info : {},
	host : {},
	basePath : {},
	schemes : {},
	securityDefinitions	: {},
	paths : {},
	definitions : {}
};

var allowedParams = ['Query','Path','Form Data']

function toSwagger(apidocJson, projectJson) {
	swagger.info = addInfo(projectJson);
	swagger.host = getHost(projectJson);
	swagger.basePath = getBasePath(projectJson);
	swagger.schemes = getSchemes(projectJson);
	swagger.securityDefinitions = addSecurityDefinitions();
	swagger.paths = extractPaths(apidocJson);
	return swagger;
}

var tagsRegex = /(<([^>]+)>)/ig;
// Removes <p> </p> tags from text
function removeTags(text) {
	return text ? text.replace(tagsRegex, "") : text;
}

function addInfo(projectJson) {
	var info = {};
	info["title"] = projectJson.title || projectJson.name;
	info["version"] = projectJson.version;
	info["description"] = projectJson.description;
	return info;
}

/**
*
*
*
*
*/
function getHost(projectJson){
	var hostname;
	var url = projectJson.url;
    //find & remove protocol (http, ftp, etc.) and get hostname

    if (url.indexOf("://") > -1) {
        hostname = url.split('/')[2];
    }
    else {
        hostname = url.split('/')[0];
    }

    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];

    return hostname;
	//return projectJson.
}

/**
*
*
*
*
*/
function getBasePath(projectJson){
	var url = projectJson.url;
	var base = '';

	var path = url.split('/');

	if(typeof path[3] !== 'undefined')
		base = '/'+path[3];

	return base;
}

/**
*
*
*
*
*/
function getSchemes(projectJson){
	var url = projectJson.url;
	var schemeArr = [];
	var scheme = '';

	if (url.indexOf("://") > -1) {
        scheme = url.split('/')[0];
        //find & remove port number
    	scheme = scheme.split(':')[0];
    	schemeArr.push(scheme);
    }

    return schemeArr;
}


/**
*
*
*
*
*/
function addSecurityDefinitions(){
	var security = {};
	security["bearer"] = {type : 'apiKey', name : 'Authorization', in : 'header'};

	return security;
}

/**
 * Extracts paths provided in json format
 * post, patch, put request parameters are extracted in body
 * get and delete are extracted to path parameters
 * @param apidocJson
 * @returns {{}}
 */
function extractPaths(apidocJson){
	var apiPaths = groupByUrl(apidocJson);
	var paths = {};
	for (var i = 0; i < apiPaths.length; i++) {
		var verbs = apiPaths[i].verbs;
		var url = verbs[0].url;
		var pattern = pathToRegexp(url, null);
		var matches = pattern.exec(url);

		// Surrounds URL parameters with curly brackets -> :email with {email}
		var pathKeys = [];
		for (var j = 1; j < matches.length; j++) {
			var key = matches[j].substr(1);
			url = url.replace(matches[j], "{"+ key +"}");
			pathKeys.push(key);
		}

		for(var j = 0; j < verbs.length; j++) {
			var verb = verbs[j];
			// Convert method(post/get/patch) to lower case
			verb.type = verb.type.toLowerCase();
			var type = verb.type;
			var obj = paths[url] = paths[url] || {};
			if (type == 'post' || type == 'patch' || type == 'put') {
				_.extend(obj, createPostPushPutOutput(verb, swagger.definitions, pathKeys));
			} else {
				_.extend(obj, createGetDeleteOutput(verb, swagger.definitions));
			}
		}
	}
	return paths;
}

function createPostPushPutOutput(verbs, definitions, pathKeys) {
	var pathItemObject = {};
	var verbDefinitionResult = createVerbDefinitions(verbs,definitions);

	var params = [];
	var pathParams = createPathParameters(verbs, pathKeys);

	pathParams = _.filter(pathParams, function(param) {
		var hasKey = pathKeys.indexOf(param.name) !== -1;
		return !(param.in === "path" && !hasKey)
	});

	params = params.concat(pathParams);
	var required = verbs.parameter && verbs.parameter.fields && pathParams.length > 0;

	for (var i = params.length - 1; i >= 0; i--) {
		var param = params[i];
		var type  = param.in;
		var consume = 'application/x-www-form-urlencoded';

		if(type == 'body'){

			consume = 'application/json';

			params.push({
				"in": "body",
				"name": "body",
				"description": removeTags(verbs.description),
				"required": required,
				"schema": {
					"$ref": "#/definitions/" + 'Parameter-' + verbDefinitionResult.topLevelParametersRef
				}
			});
		}

		pathItemObject[verbs.type] = {
			tags: [verbs.group],
			summary: removeTags(verbs.description),
			consumes: [
				consume
			],
			produces: [
				"application/json"
			],
			parameters: params
		}
	}

	

	// if Contain data headers then check for authorization 
	if(verbs.header){
		// Apply the security if exists
		var security = createSecurity(verbs);
		if (!isEmpty(security) && typeof pathItemObject[verbs.type] !== 'undefined')
			pathItemObject[verbs.type].security = security;
	}
	
	if (verbDefinitionResult.topLevelSuccessRef /*&& typeof pathItemObject[verbs.type] !== 'undefined'*/) {

		if(typeof pathItemObject[verbs.type] === 'undefined'){
			pathItemObject[verbs.type] = {};
			pathItemObject[verbs.type].tags = [verbs.group];
			pathItemObject[verbs.type].produces = ["application/json"];
		}

		pathItemObject[verbs.type].responses = {
          "200": {
            "description": "successful operation",
            "schema": {
              //"type": verbDefinitionResult.topLevelSuccessRefType,
              //"items": {
                "$ref": "#/definitions/" +verbDefinitionResult.topLevelSuccessRef
              //}
            }
          }
      	};
	};
	
	return pathItemObject;
}

function createVerbDefinitions(verbs, definitions) {
	var result = {
		topLevelParametersRef : null,
		topLevelSuccessRef : null,
		topLevelSuccessRefType : null
	};
	var defaultObjectName = verbs.name;

	for (var i = allowedParams.length - 1; i >= 0; i--) {
		var p = allowedParams[i];
		

		if(typeof verbs.parameter === 'undefined' || typeof verbs.parameter.fields === 'undefined')
			continue;

		var pathParams = verbs.parameter.fields[p];

		if(typeof pathParams === 'undefined')
			continue;

		var fieldArrayResult = {};
		if (verbs && verbs.parameter && verbs.parameter.fields) {

			if(verbs.parameter.fields[p] == ''){
				fieldArrayResult = createFieldArrayDefinitions(verbs.parameter.fields[p], definitions, verbs.name, defaultObjectName);		
				result.topLevelParametersRef = fieldArrayResult.topLevelRef;
			}
		};
	}

	if (verbs && verbs.success && verbs.success.fields) {
		fieldArrayResult = createFieldArrayDefinitions(verbs.success.fields["Success 200"], definitions, verbs.name, defaultObjectName);		
		result.topLevelSuccessRef = fieldArrayResult.topLevelRef;
		result.topLevelSuccessRefType = fieldArrayResult.topLevelRefType;
	};
	
	return result;
}

function createFieldArrayDefinitions(fieldArray, definitions, topLevelRef, defaultObjectName) {
	var result = {
		topLevelRef : topLevelRef,
		topLevelRefType : null
	}

	var emptyRef = [];
	var parentRefType = [];
	var fields = [];

	if (!fieldArray) {
		return result;
	}

	for (var i = 0; i < fieldArray.length; i++) {
		var parameter = fieldArray[i];

		var nestedName = createNestedName(parameter.field);
		var objectName = nestedName.objectName;
		if (!objectName) {
			objectName = defaultObjectName;
		}

		var type = parameter.type;
		var field = parameter.field;

		if (i == 0) {
			result.topLevelRefType = type;
			if(parameter.type == "Object") {
				objectName = nestedName.propertyName;
				nestedName.propertyName = null;
			} else if (parameter.type == "Array") {
				objectName = nestedName.propertyName;
				nestedName.propertyName = null;				
				result.topLevelRefType = "array";
			}
			result.topLevelRef = objectName;
		};
		var definitionKey = (objectName == defaultObjectName) ? objectName : objectName+'-'+defaultObjectName;

		definitions[definitionKey] = definitions[definitionKey] ||
			{ properties : {}, required : [] , type : "object" };

		if (nestedName.propertyName) {
			var prop = { type: (parameter.type || "").toLowerCase(), description: removeTags(parameter.description) };
			if(parameter.type == "Object") {
				var dkey = parameter.field+'-'+objectName;
				prop.$ref = "#/definitions/" + dkey;
			}

			var typeIndex = type.indexOf("[]");
			if(typeIndex !== -1 && typeIndex === (type.length - 2)) {
				prop.type = "array";
				prop.items = {
					type: type.slice(0, type.length-2)
				};
				var dkey = parameter.field+'-'+defaultObjectName;
				prop = { $ref : "#/definitions/" + dkey };

				parentRefType[parameter.field] = {
					'key'  :  dkey,
					'type' : type.toLowerCase()
				};
			}
			
			// Update type value on definitions
			var child = field.indexOf(".");
			if(child > 0){
				var fieldArr = field.split(".");
				
				fieldArr.splice(-1,1);
				var parentField = fieldArr.join('.');

				var parentObj  = parentRefType[parentField];

				if(parentObj.type == 'array[]'){
					definitions[parentObj.key]['type'] = "array";
				}
			}

			definitions[definitionKey]['properties'][nestedName.propertyName] = prop;
			if (!parameter.optional) {
				var arr = definitions[definitionKey]['required'];
				if(arr.indexOf(nestedName.propertyName) === -1) {
					arr.push(nestedName.propertyName);
				}
			};

		};

		var ptype = parameter.type;

		if(ptype.toLowerCase() == 'array[]' || ptype.toLowerCase() == 'object[]'){
			var refObj = {};
			refObj.dk = definitionKey;
			refObj.pn = nestedName.propertyName;
			refObj.dn = definitions;
			refObj.fl = parameter.field;

			emptyRef.push(refObj);
		}
		
		fields.push(parameter.field);
	}

	var fieldstr = fields.join();
	for (var i = emptyRef.length - 1; i >= 0; i--) {
		var refObj = emptyRef[i];
		var find = refObj.fl+'.';
		var pos = fieldstr.lastIndexOf(find);
		if(pos < 0){
			createEmptyDefinition(refObj.dk, refObj.pn, refObj.dn);
		}
	}

	return result;
}

function createEmptyDefinition(key, propName,definitions){
	var prop = {};  

	prop.type = "string";
	prop.description = '';

	// Set New Definitions
	definitions['empty-data'] = { properties : {} , type : "object" };
	definitions['empty-data']['properties']['empty'] = prop;

	// Change missing ref definitions
	var prop = {$ref : '#/definitions/empty-data'}; 
	definitions[key]['properties'][propName] = prop;
}

function createNestedName(field) {
	var propertyName = field;
	var objectName;
	var propertyNames = field.split(".");
	if(propertyNames && propertyNames.length > 1) {
		propertyName = propertyNames[propertyNames.length-1];
		propertyNames.pop();
		objectName = propertyNames.join(".");
	}

	return {
		propertyName: propertyName,
		objectName: objectName
	}
}


/**
 * Generate get, delete method output
 * @param verbs
 * @returns {{}}
 */
function createGetDeleteOutput(verbs,definitions) {
	var pathItemObject = {};
	verbs.type = verbs.type === "del" ? "delete" : verbs.type;

	var verbDefinitionResult = createVerbDefinitions(verbs,definitions);

	pathItemObject[verbs.type] = {
		tags: [verbs.group],
		summary: removeTags(verbs.description),
		consumes: [
			"application/json"
		],
		produces: [
			"application/json"
		],
		parameters: createPathParameters(verbs)
	}

	// if Contain data headers then check for authorization 
	if(verbs.header){
		// Apply the security if exists
		var security = createSecurity(verbs);
		if (!isEmpty(security))
			pathItemObject[verbs.type].security = security;
	}

	if (verbDefinitionResult.topLevelSuccessRef) {
		pathItemObject[verbs.type].responses = {
          "200": {
            "description": "successful operation",
            "schema": {
              //"type": verbDefinitionResult.topLevelSuccessRefType,
              //"items": {
                "$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
              //}
            }
          }
      	};
	};
	return pathItemObject;
}

/**
 * Iterate through all method parameters and create array of parameter objects which are stored as path parameters
 * @param verbs
 * @returns {Array}
 */
function createPathParameters(verbs, pathKeys) {
	pathKeys = pathKeys || [];

	var pathItemObject = [];
	var params = [];
	var inType = '';
	var alias = {'number':'integer','int':'integer','integer':'integer'}

	if (verbs.parameter) {
	
		for (var i = allowedParams.length - 1; i >= 0; i--) {
			var p = allowedParams[i];
			
			if(typeof verbs.parameter.fields === "undefined")
				continue;

			var pathParams = verbs.parameter.fields[p];

			if(typeof pathParams === 'undefined')
				continue;

			params = pathParams;

			switch(p) {
				case 'Query':
					inType = 'query';
				break;

				case 'Path':
					inType = 'path';
				break;

				case 'Form Data':
					inType = 'formData';
				break;
			}

			for (var x = 0; x < params.length; x++) {
				var param = params[x];
				var field = param.field;
				var type = param.type.toLowerCase();
				
				pathItemObject.push({
					name: field,
					in: inType,//type === "file" ? "formData" : inType,
					required: !param.optional,
					type: alias[type] ? alias[type] : type,
					description: removeTags(param.description)
				});
			}

		}
	}
	return pathItemObject;
}

/**
 * Return authentication object
 * 
 * @params verbs
 * @params pathKeys
 * 
 * @return Object[]
 */
function createSecurity(verbs, pathKeys) {
	var security = [];

	var headersArr = verbs.header.fields.Header;
	headerObj = headersArr.shift();

	// Get headers key & value
	var key   = headerObj.field;
	var value = headerObj.description;

	value = removeTags(value);

	if (key == 'Authorization' && value.indexOf("Bearer ") > -1){
		security.push({bearer : []});
	}
	
	return security;
}

function groupByUrl(apidocJson) {
	return _.chain(apidocJson)
		.groupBy("url")
		.pairs()
		.map(function (element) {
			return _.object(_.zip(["url", "verbs"], element));
		})
		.value();
}

function isEmpty(myObject) {
    for(var key in myObject) {
        if (myObject.hasOwnProperty(key)) {
            return false;
        }
    }

    return true;
}

module.exports = {
	toSwagger: toSwagger
};