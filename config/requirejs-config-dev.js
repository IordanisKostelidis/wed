/**
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
require.config({
 baseUrl: 'lib/',
 paths: {
   browser_test: '../../../browser_test',
   'test-files': '../../test-files/',
   jquery: 'external/jquery',
   bootstrap: 'external/bootstrap/js/bootstrap.min',
   log4javascript: 'external/log4javascript',
   'font-awesome': 'external/font-awesome',
   'pubsub-js': 'external/pubsub',
   xregexp: 'external/xregexp',
   text: 'requirejs/text',
   optional: 'requirejs/optional',
   localforage: 'external/localforage',
   async: 'external/async',
   angular: 'external/angular',
   bootbox: 'external/bootbox',
   typeahead: 'external/typeahead.bundle.min',
   urijs: 'external/urijs',
   interact: 'external/interact.min',
   'merge-options': 'external/merge-options',
   'is-plain-obj': 'external/is-plain-obj',
   bluebird: 'external/bluebird',
   'last-resort': 'external/last-resort',
   rangy: 'external/rangy/rangy-core',
   salve: 'external/salve',
   "bootstrap-notify": "external/bootstrap-notify",
 },
 packages: [
     {
         name: "lodash",
         location: "external/lodash"
     }
 ],
 map: {
   "*": {
     bootstrap: "wed/patches/bootstrap",
     "last-resort": "wed/glue/last-resort",
   },
   "wed/glue/last-resort": {
     "last-resort": "last-resort",
   },
   "wed/patches/bootstrap": {
     bootstrap: "bootstrap",
   },
   // bootbox is buggy. It only requires jquery but it needs bootstrap too.
   // Loading bootstrap works due to the init we have below which makes
   // bootstrap return $.
   "bootbox": {
     jquery: "bootstrap",
   },
 },
 shim: {
   bootstrap: {
     deps: ["jquery"],
     exports: "jQuery.fn.popover",
     init: function ($) { return $; }
   },
   angular: {
       // AngularJS can use jQuery optionally. However, in our application
       // we MUST have jQuery loaded and available for Angular to use it.
       deps: ["jquery"],
       exports: "angular"
   },
   typeahead: {
       deps: ['jquery'],
       exports: 'Bloodhound'
   }
 },
 waitSeconds: 12,
 enforceDefine: true
});

define("global-config", {
    config: {
        schema: '/build/schemas/tei-simplified-rng.js',
        mode: {
            path: 'wed/modes/generic/generic',
            options: {
                meta: {
                    path: 'wed/modes/generic/metas/tei_meta',
                    options: {
                        metadata: '/build/schemas/tei-metadata.json'
                    }
                }
            }
        },
        // You certainly do not want this in actual deployment.
        ajaxlog: {
            url: "/build/ajax/log.txt"
        },
        // You certainly do not want this in actual deployment.
        save: {
            path: 'wed/savers/ajax',
            options: {
                url: "/build/ajax/save.txt"
            }
        }
    }
});

//  LocalWords:  popup onerror findandself jQuery Dubeau MPL Mangalam
//  LocalWords:  txt tei ajax jquery
