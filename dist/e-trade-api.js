/*!
 * Project Name: e-trade-api
 * Project Description: A promise, JSON-based library for interacting with the E-Trade API.
 * Version: 0.2.1
 * Build Timestamp: 2020-12-27T16:39:34.142Z
 * Project Homepage: https://github.com/tflanagan/node-e-trade
 * Git Location: git://github.com/tflanagan/node-e-trade.git
 * Authored By: Tristian Flanagan <contact@tristianflanagan.com> (https://github.com/tflanagan)
 * License: Apache-2.0
*/
/*!
 * Copyright 2020 Tristian Flanagan
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ETrade = void 0;
/* Dependencies */
const deepmerge_1 = __importDefault(require("deepmerge"));
const oauth_1_0a_1 = __importDefault(require("oauth-1.0a"));
const crypto_1 = __importDefault(require("crypto"));
const querystring_1 = require("querystring");
const debug_1 = require("debug");
const generic_throttle_1 = require("generic-throttle");
const axios_1 = __importDefault(require("axios"));
/* Debug */
const debugRequest = debug_1.debug('e-trade:request');
const debugResponse = debug_1.debug('e-trade:response');
/* Globals */
const VERSION = require('../package.json').version;
/* Main Class */
class ETrade {
    constructor(options) {
        this._id = 0;
        this.settings = deepmerge_1.default(ETrade.defaults, options || {});
        this.throttle = new generic_throttle_1.Throttle(this.settings.connectionLimit, this.settings.connectionLimitPeriod, this.settings.errorOnConnectionLimit);
        this.oauth = new oauth_1_0a_1.default({
            consumer: {
                key: this.settings.key,
                secret: this.settings.secret
            },
            signature_method: 'HMAC-SHA1',
            hash_function(base_string, key) {
                return crypto_1.default.createHmac('sha1', key).update(base_string).digest('base64');
            }
        });
    }
    getBasicRequest(requestOptions) {
        return deepmerge_1.default({
            method: 'GET',
            baseURL: this.settings.mode === 'prod' ? this.settings.urls.prod : this.settings.urls.dev,
            headers: {
                'User-Agent': `node-e-trade/v${VERSION} nodejs/${process.version}`
            },
            proxy: this.settings.proxy
        }, requestOptions || {});
    }
    signRequest(request, token, omit = false) {
        const options = deepmerge_1.default({}, request);
        options.url = [
            options.baseURL || '',
            options.url || ''
        ].join('');
        // TODO: implement proper fix
        // @ts-ignore - TS2790
        delete options.baseURL;
        if (token === undefined || token === true) {
            token = {
                key: this.settings.accessToken,
                secret: this.settings.accessSecret
            };
        }
        if (omit) {
            delete options.data;
        }
        const authorization = this.oauth.authorize(options, token === false ? undefined : token);
        if (!request.params) {
            request.params = {};
        }
        Object.keys(authorization).filter((key) => {
            return !omit || key.startsWith('oauth');
        }).forEach((key) => {
            request.params[key] = authorization[key];
        });
    }
    async request(options) {
        return await this.throttle.acquire(async () => {
            const id = 0 + (++this._id);
            debugRequest(id, options);
            try {
                const results = (await axios_1.default.request(options)).data;
                debugResponse(id, results);
                return results;
            }
            catch (err) {
                if (err.response) {
                    const nErr = new Error(err.response.statusText);
                    nErr.code = err.response.status;
                    if (err.response.data.Error) {
                        if (err.response.data.Error.code) {
                            nErr.code = err.response.data.Error.code;
                        }
                        nErr.message = err.response.data.Error.message;
                    }
                    nErr.raw = err.response.data;
                    err = nErr;
                }
                debugResponse(id, err);
                throw err;
            }
        });
    }
    /* OAuth Related Methods */
    async getAccessToken(options) {
        const requestOptions = this.getBasicRequest();
        delete requestOptions.baseURL;
        requestOptions.url = [
            this.settings.urls.oauth,
            'access_token'
        ].join('');
        requestOptions.data = {
            oauth_verifier: options.code
        };
        this.signRequest(requestOptions, {
            key: options.key,
            secret: options.secret
        });
        const results = querystring_1.parse(await this.request(requestOptions));
        return {
            oauth_token: '' + results.oauth_token,
            oauth_token_secret: '' + results.oauth_token_secret
        };
    }
    async renewAccessToken(options) {
        const requestOptions = this.getBasicRequest();
        delete requestOptions.baseURL;
        requestOptions.url = [
            this.settings.urls.oauth,
            'renew_access_token'
        ].join('');
        this.signRequest(requestOptions, {
            key: options.key,
            secret: options.secret
        });
        return await this.request(requestOptions);
    }
    async requestToken() {
        const requestOptions = this.getBasicRequest();
        delete requestOptions.baseURL;
        requestOptions.url = [
            this.settings.urls.oauth,
            'request_token'
        ].join('');
        requestOptions.data = {
            oauth_callback: 'oob'
        };
        this.signRequest(requestOptions, false);
        const results = querystring_1.parse(await this.request(requestOptions));
        return {
            oauth_token: '' + results.oauth_token,
            oauth_token_secret: '' + results.oauth_token_secret,
            oauth_callback_confirmed: results.oauth_callback_confirmed === 'true',
            url: `https://us.etrade.com/e/t/etws/authorize?key=${this.settings.key}&token=${results.oauth_token}`
        };
    }
    async revokeAccessToken(options) {
        const requestOptions = this.getBasicRequest();
        delete requestOptions.baseURL;
        requestOptions.url = [
            this.settings.urls.oauth,
            'revoke_access_token'
        ].join('');
        this.signRequest(requestOptions, {
            key: options.key,
            secret: options.secret
        });
        return await this.request(requestOptions);
    }
    /* E-Trade API */
    async cancelOrder({ accountIdKey, orderId }) {
        const requestOptions = this.getBasicRequest({
            method: 'PUT',
            url: `accounts/${accountIdKey}/orders/cancel.json`,
            data: {
                CancelOrderRequest: {
                    orderId: orderId
                }
            }
        });
        this.signRequest(requestOptions, undefined, true);
        return (await this.request(requestOptions)).CancelOrderResponse;
    }
    async changePreviewedOrder({ accountIdKey, orderId, orderType, clientOrderId, order }) {
        const requestOptions = this.getBasicRequest({
            method: 'PUT',
            url: `accounts/${accountIdKey}/orders/${orderId}/change/preview.json`,
            data: {
                PreviewOrderRequest: {
                    orderType: orderType,
                    clientOrderId: clientOrderId,
                    Order: order
                }
            }
        });
        this.signRequest(requestOptions, undefined, true);
        return (await this.request(requestOptions)).PreviewOrderResponse;
    }
    async deleteAlert(alertId) {
        const requestOptions = this.getBasicRequest({
            method: 'DELETE',
            url: `user/alerts/${(typeof alertId === 'number' ? alertId : alertId.join(','))}.json`
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).AlertsResponse;
    }
    async getAccountBalances({ accountIdKey, accountType, instType = 'BROKERAGE', realTimeNAV = true }) {
        const data = {
            instType: instType,
            realTimeNAV: realTimeNAV
        };
        if (accountType) {
            data.accountType = accountType;
        }
        const requestOptions = this.getBasicRequest({
            url: `accounts/${accountIdKey}/balance.json`,
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).BalanceResponse;
    }
    async getOptionChains({ symbol, expiryYear, expiryMonth, expiryDay, strikePriceNear, noOfStrikes, includeWeekly = false, skipAdjusted = true, optionCategory = 'STANDARD', chainType = 'CALLPUT', priceType = 'ATNM' }) {
        const data = {
            symbol: symbol,
            includeWeekly: includeWeekly,
            skipAdjusted: skipAdjusted,
            optionCategory: optionCategory,
            chainType: chainType,
            priceType: priceType
        };
        if (expiryYear) {
            data.expiryYear = expiryYear;
        }
        if (expiryMonth) {
            data.expiryMonth = expiryMonth;
        }
        if (expiryDay) {
            data.expiryDay = expiryDay;
        }
        if (strikePriceNear !== undefined) {
            data.strikePriceNear = strikePriceNear;
        }
        if (noOfStrikes !== undefined) {
            data.noOfStrikes = noOfStrikes;
        }
        const requestOptions = this.getBasicRequest({
            url: 'market/optionchains.json',
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).OptionChainResponse;
    }
    async getOptionExpireDates({ symbol, expiryType }) {
        const data = {
            symbol: symbol
        };
        if (expiryType) {
            data.expiryType = expiryType;
        }
        const requestOptions = this.getBasicRequest({
            url: 'market/optionexpiredate.json',
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).OptionExpireDateResponse.ExpirationDate;
    }
    async getQuotes({ symbols, detailFlag, requireEarningsDate = false, overrideSymbolCount = false, skipMiniOptionsCheck = false }) {
        const data = {
            requireEarningsDate: requireEarningsDate,
            overrideSymbolCount: overrideSymbolCount,
            skipMiniOptionsCheck: skipMiniOptionsCheck
        };
        if (detailFlag) {
            data.detailFlag = detailFlag;
        }
        const requestOptions = this.getBasicRequest({
            url: `market/quote/${typeof (symbols) === 'string' ? symbols : symbols.join(',')}.json`,
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).QuoteResponse.QuoteData;
    }
    async listAccounts() {
        const requestOptions = this.getBasicRequest({
            url: 'accounts/list.json'
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).AccountListResponse.Accounts.Account;
    }
    async listAlertDetails({ alertId, htmlTags = false }) {
        const requestOptions = this.getBasicRequest({
            url: `user/alerts/${alertId}.json`,
            data: {
                htmlTags: htmlTags
            }
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).AlertDetailsResponse;
    }
    async listAlerts(options) {
        const data = {};
        if (options) {
            if (options.count) {
                data.count = options.count;
            }
            if (options.category) {
                data.category = options.category;
            }
            if (options.status) {
                data.status = options.status;
            }
            if (options.direction) {
                data.direction = options.direction;
            }
            if (options.search) {
                data.search = options.search;
            }
        }
        const requestOptions = this.getBasicRequest({
            url: 'user/alerts.json',
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).AlertsResponse;
    }
    async listOrders({ accountIdKey, marker, count, status, fromDate, toDate, symbol, securityType, transactionType, marketSession }) {
        const data = {};
        if (marker) {
            data.marker = marker;
        }
        if (count) {
            data.count = count;
        }
        if (status) {
            data.status = status;
        }
        if (fromDate) {
            data.fromDate = fromDate;
        }
        if (toDate) {
            data.toDate = toDate;
        }
        if (symbol) {
            data.symbol = symbol;
        }
        if (securityType) {
            data.securityType = securityType;
        }
        if (transactionType) {
            data.transactionType = transactionType;
        }
        if (marketSession) {
            data.marketSession = marketSession;
        }
        const requestOptions = this.getBasicRequest({
            url: `accounts/${accountIdKey}/orders.json`,
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).OrdersResponse;
    }
    async listTransactionDetails({ accountIdKey, transactionId, storeId }) {
        const data = {};
        if (storeId) {
            data.storeId = storeId;
        }
        const requestOptions = this.getBasicRequest({
            url: `accounts/${accountIdKey}/transactions/${transactionId}.json`,
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).TransactionDetailsResponse;
    }
    async listTransactions({ accountIdKey, startDate, endDate, sortOrder, marker, count }) {
        const data = {};
        if (startDate) {
            data.startDate = startDate;
        }
        if (endDate) {
            data.endDate = endDate;
        }
        if (sortOrder) {
            data.sortOrder = sortOrder;
        }
        if (marker) {
            data.marker = marker;
        }
        if (count) {
            data.count = count;
        }
        const requestOptions = this.getBasicRequest({
            url: `accounts/${accountIdKey}/transactions.json`,
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).TransactionListResponse;
    }
    async lookupProduct(search) {
        const requestOptions = this.getBasicRequest({
            url: `market/lookup/${search}.json`
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).LookupResponse.Data;
    }
    async placeChangedOrder({ accountIdKey, orderId, orderType, order, clientOrderId, previewIds }) {
        const requestOptions = this.getBasicRequest({
            method: 'PUT',
            url: `accounts/${accountIdKey}/orders/${orderId}/change/place.json`,
            data: {
                PlaceOrderRequest: {
                    orderType: orderType,
                    clientOrderId: clientOrderId,
                    Order: order,
                    PreviewIds: previewIds
                }
            }
        });
        this.signRequest(requestOptions, undefined, true);
        return (await this.request(requestOptions)).PlaceOrderResponse;
    }
    async placeOrder({ accountIdKey, orderType, order, clientOrderId, previewIds }) {
        const requestOptions = this.getBasicRequest({
            method: 'POST',
            url: `accounts/${accountIdKey}/orders/place.json`,
            data: {
                PlaceOrderRequest: {
                    orderType: orderType,
                    clientOrderId: clientOrderId,
                    Order: order,
                    PreviewIds: previewIds
                }
            }
        });
        this.signRequest(requestOptions, undefined, true);
        return (await this.request(requestOptions)).PlaceOrderResponse;
    }
    async previewOrder({ accountIdKey, orderType, order, clientOrderId }) {
        const requestOptions = this.getBasicRequest({
            method: 'POST',
            url: `accounts/${accountIdKey}/orders/preview.json`,
            data: {
                PreviewOrderRequest: {
                    orderType: orderType,
                    clientOrderId: clientOrderId,
                    Order: order
                }
            }
        });
        this.signRequest(requestOptions, undefined, true);
        return (await this.request(requestOptions)).PreviewOrderResponse;
    }
    async viewLotsDetails({ accountIdKey, positionId }) {
        const requestOptions = this.getBasicRequest({
            url: `accounts/${accountIdKey}/portfolio/${positionId}.json`
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).PositionLotsResponse;
    }
    async viewPortfolio({ accountIdKey, count, sortBy, sortOrder = 'DESC', marketSession = 'REGULAR', totalsRequired = false, lotsRequired = false, view = 'QUICK' }) {
        const data = {
            sortOrder: sortOrder,
            marketSession: marketSession,
            totalsRequired: totalsRequired,
            lotsRequired: lotsRequired,
            view: view
        };
        if (count) {
            data.count = count;
        }
        if (sortBy) {
            data.sortBy = sortBy;
        }
        const requestOptions = this.getBasicRequest({
            url: `accounts/${accountIdKey}/portfolio.json`,
            data: data
        });
        this.signRequest(requestOptions);
        return (await this.request(requestOptions)).PortfolioResponse.AccountPortfolio;
    }
}
exports.ETrade = ETrade;
ETrade.VERSION = VERSION;
ETrade.defaults = {
    mode: 'dev',
    key: '',
    secret: '',
    accessToken: '',
    accessSecret: '',
    urls: {
        oauth: 'https://api.etrade.com/oauth/',
        prod: 'https://api.etrade.com/v1/',
        dev: 'https://apisb.etrade.com/v1/'
    },
    connectionLimit: 10,
    connectionLimitPeriod: 1000,
    errorOnConnectionLimit: false,
    proxy: false
};
//# sourceMappingURL=e-trade-api.js.map