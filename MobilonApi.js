/**
 * Mobilon WebApi
 * {@link http://developer.mobilon.ru}
 * @version 1.1.14-255
 * Date: 24.07.2014
 */

(function(window, undefined) {
    /**
     * @global
     * @constructor
     * @param {Object} settings
     * @return {Object}
     */
    function MobilonApi(settings) {
        var socket = null;
        var debug = false;
        var reconnectInterval = 1000;
        var actions = {};
        var subscriptionHandlers = {};
        var connectionString = '';
        var protocol = 'v1';
        var connectionTimeoutId = null;
        var authenticated = false;
        var disconnectForcedByUser = false;

        if (settings) {
            if (!!settings.debug) {
                debug = !!settings.debug;
            }
            if (settings.reconnectInterval) {
                reconnectInterval = settings.reconnectInterval;
            }
        }

        var actions_sent = 0;

        var log = function(message) {
            if (debug) {
                console.log(message);
            }
        };

        var onError = function(error) {
            log(error);
        };

        var onReady = function() {

        };

        function check(message) {
            for (var id in actions) {
                var action = actions[id];
                if (id == message.id) {
                    var isSubscription = (typeof subscriptionHandlers[id] == 'function');
                    var infoType = isSubscription ? 'Subscription' : 'Action';

                    if (message.status == 'OK') {
                        log(infoType + ' ' + id + ': DATA');
                        return true;
                    } else if (message.status == 'error') {
                        action.error(message.data);
                        log('ERROR! ' + infoType + ' ' + id + ': ' + message.data);
                        return false;
                    }
                }
            }
            return false;
        }

        function send(data) {
            data = JSON.stringify(data);
            log("Sending " + data + " to " + connectionString);
            socket.send(data);
        }

        function sendAction(id) {
            send({
                'action': actions[id].action,
                'data': actions[id].data,
                'id': id
            });
        }

        function handle(event) {
            var message = JSON.parse(event.data);
            if (!check(message)) {
                return;
            }
            if (subscriptionHandlers[message.id]) {
                var handler = subscriptionHandlers[message.id];
                handler(message.data);
                return;
            }
            if (actions[message.id]) {
                var currentAction = actions[message.id];

                var onTypes = {
                    subscription: function() {
                        subscriptionHandlers[message.id] = currentAction.success;
                        currentAction.success(message.data);
                    },
                    action: function() {
                        currentAction.success(message.data);
                        delete actions[message.id];
                    }
                };

                var handler = onTypes[currentAction.type];

                if (typeof handler !== 'function') {
                    currentAction.error(
                            'Type of action "' + currentAction.type + '" is not defined.'
                            );
                } else {
                    handler();
                }
                return;
            }
        }
        /**
         * 
         * @param {type} action
         * @param {type} type
         * @param {type} data
         * @param {Function} success
         * @param {?Function} error
         * @returns {Number} id отправленного действия
         */
        function register(action, type, params) {
            if (!params) {
                params = {
                    data: {},
                    success: log,
                    error: log
                };
            }
            var data = params.data,
                success = params.success,
                error = params.error;
            if (typeof success !== 'function') {
                success = function (data) {
                    log(data);
                };
            }
            if (typeof error !== 'function') {
                error = onError;
            }
            if (!data) {
                data = {};
            }
            if (!socket || socket.readyState !== 1) {
                error('Websocket connection not established for action ' + action + '.');
                return;
            }
            if (!type) {
                type = 'action';
            }
            var id = ++actions_sent;
            actions[id] = {
                'action': action,
                'data': data,
                'success': success,
                'error': error,
                'type': type
            };
            sendAction(id);
            return id;
        }

        function authenticate(params) {
            register(
                'connect',
                'action',
                {
                    data: params.data,
                    success: function(data) {
                        authenticated = true;
                        params.success(data);
                        onReady(data);
                    },
                    error: function() {
                        socket.close();
                        params.error();
                    }
                }
            );
        }

        function getHtmlElementFromJson(json) {
            var element = {};
            if (typeof json === 'string') {
                element = JSON.parse(json);
            } else if (typeof json === 'object') {
                element = json;
            }

            var tokens = element.tokens;
            var templateFn = doT.template(getTemplate(element.type));

            return templateFn(tokens);
        }
        /**
         * 
         * @param {String|Object} json
         * @returns {String}
         */
        function getHtmlFormFromJson(json) {
            var elements = {};
            if (typeof json === 'string') {
                elements = JSON.parse(json);
            } else if (typeof json === 'object') {
                elements = json;
            }
            var html = "";
            for (var key in elements) {
                html += getHtmlElementFromJson(elements[key]);
            }

            return html;
        }
        /**
         * 
         * @param {Object} params
         */
        function fetchConnectionString(params) {
            if (params.data.uri) {
                connectionString = params.data.uri;
            }
            else {
                connectionString = params.data.connectionString;
            }
            connectionString += '/' + protocol;
        }

        function connect(params) {
            if (connectionTimeoutId) {
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = null;
            }
            fetchConnectionString(params);
            if (!params.error) {
                params.error = log;
            }
            socket = new WebSocket(connectionString);
            socket.onmessage = function(event) {
                handle(event);
            };
            socket.onerror = function(event) {
                authenticated = false;
                params.error('Connection error');
                log('Connection error');
            };
            socket.onopen = function() {
                log("Connected to " + connectionString);
                disconnectForcedByUser = false;
                authenticate(params);
            };
            socket.onclose = function(event) {
                authenticated = false;
                subscriptionHandlers = {};
                actions = {};
                params.error('Connection closed');
                log('Connection closed');
                if (reconnectInterval > 0 && !disconnectForcedByUser) {
                    connectionTimeoutId = setTimeout(function() {
                        connect(params);
                    }, reconnectInterval);
                }
            }
        }

        return {
            isReady: function() {
                return (socket && socket.readyState == 1 && authenticated);
            },
            setDebug: function(state) {
                debug = !!state;
            },
            setReconnectInterval: function(value) {
                reconnectInterval = parseInt(value);
            },
            onError: function(handler) {
                onError = handler;
            },
            onReady: function(handler) {
                onReady = handler;
            },
            connect: function(params) {
                connect(params);
            },
            disconnect: function(params) {
                disconnectForcedByUser = true;
                if (socket.readyState == 1) {
                    socket.close();
                    if (params && params.success) {
                        params.success();
                    }
                } else {
                    if (params && params.error) {
                        params.error('Socket not connected.');
                    }
                }
            },
            subscribeOnSubscribersState: function(params) {
                return register(
                    'subscribeOnSubscribersState',
                    'subscription',
                    params
                );
            },
            subscribeOnSubscribersState2: function(params) {
                return register(
                    'subscribeOnSubscribersState2',
                    'subscription',
                    params
                );
            },
            subscribeOnOperatorsState: function(params) {
                return register(
                    'subscribeOnOperatorsState',
                    'subscription',
                    params
                );
            },
            subscribeOnFormSending: function(params) {
                return register(
                    'subscribeOnFormSending',
                    'subscription',
                    params
                );
            },
            getSubscriber: function(params) {
                register(
                    'getSubscriber',
                    'action',
                    params
                );
            },
            /**
             * @tutorial getSubscribers
             * @param {Object} params
             * @returns {undefined}
             */
            getSubscribers: function(params) {
                register(
                    'getSubscribers',
                    'action',
                    params
                );
            },
            getQueues: function(params) {
                register(
                    'getQueues',
                    'action',
                    params
                );
            },
            getOperators: function(params) {
                register(
                    'getOperators',
                    'action',
                    params
                );
            },
            getUsers: function(params) {
                register(
                    'getUsers',
                    'action',
                    params
                );
            },
            /**
             * Создаёт форму с переданными данными
             * schema, options, data в structure должны соответствовать AlpacaJS
             * {@link http://alpacajs.org}
             *
             * <p>Использование:</p>
             * <code>
             * <pre>
             * api.createFormStructure({
             *      success: function() {
             *          console.log('Структура создана!');
             *      },
             *      error: function(error) {
             *          console.log('Ошибка создания структуры:');
             *          console.log(error);
             *      },
             *      data: {
             *          name: 'Новая форма',
             *          schema: alpacaJsSchema,
             *          options: alpacaJsOptions,
             *          data: alpacaJsData
             *      }
             * });
             * </pre>
             * </code>
             *
             * @tutorial createFormStructure
             * @param {Object} params
             * @returns {undefined}
             */
            createFormStructure: function(params) {
                register(
                    'createFormStructure',
                    'action',
                    params
                );
            },
            /**
             * Возвращает структуры форм
             * @param {Object} params
             * @returns {undefined}
             * @tutorial getFormStructures
             */
            getFormStructures: function(params) {
                register(
                    'getFormStructures',
                    'action',
                    params
                );
            },
            /**
             * Возвращает структуру форму по id
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var myFormStructureId = 42;
             * var myFormStructure;
             * api.getOneFormStructure({
             *      success: function(data) {
             *          myFormStructure = data;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка получения структуры формы:');
             *          console.log(error);
             *      },
             *      data: {
             *          id : myFormStructureId
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial getOneFormStructure
             */
            getOneFormStructure: function(params) {
                register(
                    'getOneFormStructure',
                    'action',
                    params
                );
            },
            /**
             * Обновляет переданные поля в структуре формы, выбираемой по id
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var myFormStructureId = 42;
             * api.updateFormStructure({
             *      success: function() {
             *          console.log('Форма успешно обновлена!');
             *      },
             *      error: function(error) {
             *          console.log('Ошибка обновления структуры формы:');
             *          console.log(error);
             *      },
             *      data: {
             *          id : myFormStructureId,
             *          structure : {
             *              name: newFormStructureName,
             *              schema: newAlpacaJsSchema,
             *              options: newAlpacaJsOptions,
             *              data: newAlpacaJsData
             *          }
             *      }
             * });
             * </pre>
             * </code> 
             * @param {object} params
             * @returns {undefined}
             * @tutorial updateFormStructure
             */
            updateFormStructure: function(params) {
                register(
                    'updateFormStructure',
                    'action',
                    params
                );
            },
            /**
             * Удаляет структуру формы по id
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var myFormStructureId = 42;
             * api.deleteFormStructure({
             *      success: function() {
             *          console.log('Форма успешно удалена!');
             *      },
             *      error: function(error) {
             *          console.log('Ошибка удаления структуры формы:');
             *          console.log(error);
             *      },
             *      data: {
             *          id : myFormStructureId
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial deleteFormStructure
             */
            deleteFormStructure: function(params) {
                register(
                    'deleteFormStructure',
                    'action',
                    params
                );
            },
            /**
             * Сохраняет данные формы с выбранными именем, структурой
             * <p>Использование:</p>
             * <code>
             * <pre>
             * api.saveForm({
             *      success: function() {
             *          console.log('Данные сохранены.');
             *      },
             *      error: function(error) {
             *          console.log('Ошибка удаления структуры формы:');
             *          console.log(error);
             *      },
             *      data: {
             *          // имя формы как оно будет отображено в статистике
             *          name : myFormName,
             *          // структура формы, полученная с сервера
             *          structure : myFormStructure,
             *          // данные формы в формате AlpacaJS
             *          value : myFormData
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial saveForm
             */
            saveForm: function(params) {
                register(
                    'saveForm',
                    'action',
                    params
                );
            },
            /**
             * Получает данные заполненных форм, сгруппированные по именам
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var myForms;
             * api.getForms({
             *      success: function(data) {
             *          myForms = data;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка получения данных форм:');
             *          console.log(error);
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial getForms
             */
            getForms: function(params) {
                register(
                    'getForms',
                    'action',
                    params
                );
            },
            /**
             * Получает данные формы по id
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var myFormDataId = 42;
             * var myFormData;
             * api.getOneForm({
             *      success: function(data) {
             *          myFormData = data;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка получения данных формы:');
             *          console.log(error);
             *      },
             *      data : {
             *          id : myFormDataId
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial getOneForm
             */
            getOneForm: function(formId, successHandler, errorHandler) {
                register(
                    'getOneForm',
                    'action',
                    {
                        data:  { id: formId },
                        success: successHandler,
                        error: errorHandler
                    }
                );
            },
            /**
             * Регистрирует оператора по pin-коду
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var operatorPin = 4224;
             * var operatorData;
             * api.registerOperator({
             *      success: function(data) {
             *          operatorData = data;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка регистрации оператора:');
             *          console.log(error);
             *      },
             *      data : {
             *          pin : operatorPin
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial registerOperator
             */
            registerOperator: function(params) {
                register(
                    'registerOperator',
                    'action',
                    params
                );
            },
            /**
             * Разрегистрирует оператора по id
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var operatorId = 42;
             * api.registerOperator({
             *      success: function(data) {
             *          operatorData = data;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка регистрации оператора:');
             *          console.log(error);
             *      },
             *      data : {
             *          operatorId : operatorId
             *      }
             * });
             * </pre>
             * </code>
             * @param {object} params
             * @returns {undefined}
             * @tutorial registerOperator
             */
            deregisterOperator: function(params) {
                register(
                    'deregisterOperator',
                    'action',
                    params
                );
            },
            /**
             * <p>Осуществляет звонок на указанный номер number
             *  от абонента caller</p>
             * 
             * <pre>
             * {
             *      number: '123456', // Вызываемый номер
             *      //<i>caller: 'S1234', // SIP вызывающего абонента (в случае отсутствия автоматически берется номер текущего абонента)</i>
             *      //<i>operatorId: '9000001' // Id оператора с устройства которого требуется совершить звонок</i>
             * }
             * </pre>
             * <p>Использование:</p>
             * <code>
             * <pre>
             * api.call({
             *      success: function(data) {
             *          console.log(data);
             *      },
             *      error: function(error) {
             *          console.log('Ошибка:');
             *          console.log(error);
             *      },
             *      data: {
             *          number: '123456'
             *      }
             * });
             * </pre>
             * </code>
             * 
             * 
             * @tutorial call
             * @param {Object} params
             * @returns {undefined}
             */
            call: function(params) {
                register(
                    'call',
                    'action',
                    params
                );
            },
            /**
             * @deprecated in favor of {@link getCalls}
             * @param {type} params
             * @returns {undefined}
             */
            getCallsForSubscriber: function(params) {
                register(
                    'getCallsForSubscriber',
                    'action',
                    params
                );
            },
            /**
             * Возвращает историю звонков коллцентра (type:queue) или обычных
             * <p>Использование:</p>
             * <code>
             * <pre>
             * var callCenterCalls;
             * api.getCalls({
             *      success: function(data) {
             *          callCenterCalls = data.queueCallStat;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка:');
             *          console.log(error);
             *      },
             *      data: {
             *          // Звонки в колл-центр
             *          type: 'queue',
             *          // получить 10 звонков считая со 2го от последнего по времени
             *          offset: 2,
             *          limit: 10,
             *          filter: {
             *              // Нужны звонки с номера 83912123456
             *              callerid: '83912123456',
             *              // Поступившие операторам 2000001 и 1000001
             *              operator_id: ['2000001', '1000001'],
             *              duration: {
             *                   'more' : 10, // Длительностью больше 10 секунд
             *                   'less' : 60 // и меньше 60
             *              },
             *              time: {
             *                   'more' : '2013-01-01 00:00:00',
             *                   'less' : '2013-01-01 23:59:59' // узнаем кто звонит первого января
             *              }
             *          }
             *      }
             * });
             *
             * var commonCalls;
             * api.getCalls({
             *      success: function(data) {
             *          commonCalls = data.callStat;
             *      },
             *      error: function(error) {
             *          console.log('Ошибка:');
             *          console.log(error);
             *      },
             *      data: {
             *          // получить 20 звонков считая со 2го от последнего по времени
             *          offset: 2,
             *          limit: 20,
             *          filter: {
             *              // Нужны все звонки с номера 83912123456
             *              callerid: '83912123456'
             *          }
             *      }
             * });
             * </pre>
             * </code>
             * 
             * @tutorial call
             * @param {Object} params
             * @returns {undefined}
             */
            getCalls: function(params) {
                register(
                    'getCalls',
                    'action',
                    params
                );
            },
            getDepartments: function(params) {
                register(
                    'getDepartments',
                    'action',
                    params
                );
            },
            subscribeOnCalls: function(params) {
                return register(
                    'subscribeOnCalls',
                    'subscription',
                    params
                );
            },
            subscribeOnQueueCalls: function(params) {
                return register(
                    'subscribeOnQueueCalls',
                    'subscription',
                    params
                );
            },
            getCall: function(params) {
                register(
                    'getCall',
                    'action',
                    params
                );
            },
            unsubscribe: function(params) {
                register(
                    'unsubscribe',
                    'action',
                    params
                );
                var subscriptionId = params.data.subscriptionId;
                if (subscriptionHandlers[subscriptionId]) {
                    delete subscriptionHandlers[subscriptionId];
                }
            },
            sendMail: function(params) {
                register(
                    'sendMail',
                    'action',
                    params
                );
            },
            pickup: function(params) {
                register(
                    'pickup',
                    'action',
                    params
                );
            },
            redirect: function(params) {
                register(
                    'redirect',
                    'action',
                    params
                );
            },
            setTextStatus: function(params) {
                register(
                    'setTextStatus',
                    'action',
                    params
                );
            },
            subscribeOnUsers: function(params) {
                register(
                    'subscribeOnUsers',
                    'subscription',
                    params
                );
            }
        };
    }

    var mApi = function(settings) {
        return new MobilonApi(settings);
    };

    if (typeof module === "object" && module && typeof module.exports === "object") {
        module.exports = mApi;
    } else {
        window.MobilonApi = mApi;
        if (typeof define === "function" && define.amd) {
            define("MobilonApi", [], function() {
                return mApi;
            });
        }
    }

})(window);