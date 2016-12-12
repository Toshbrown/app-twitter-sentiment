
const request = require('request');
const url = require('url');
const httpsAgent = require('./databox-https-agent.js');
const macaroonCache = require('./databox-macaroon-cache.js');

//
//Databox ENV vars
//
const DATABOX_ARBITER_ENDPOINT = process.env.DATABOX_ARBITER_ENDPOINT || "https://databox-arbiter:8080";

/**
 * This module wraps the node request module https://github.com/request/request and adds:
 * 
 * 1) an https agetnt that trust the container manger CA
 * 2) appropriate arbiter token when communicating with the arbiter
 * 3) Requests and caches macaroon form the arbiter before communicating with databox components other then the arbiter.
 *   
 * @param {object} options a request option object (The only required option is uri) 
 * @param {function} callback a call back on completion. The callback argument gets 3 arguments error, response, body 
 */
module.exports = function (options,callback) {

  //use the databox https agent
  options.agent = httpsAgent;

  //
  // Workout the host and path of the request
  //
  var urlObject = url.parse(options.uri);
  var path = urlObject.pathname;
  var host = urlObject.hostname;
  
  //request to arbiter do not need a macaroon but do need the ARBITER_TOKEN
  var isRequestToArbiter = DATABOX_ARBITER_ENDPOINT.indexOf(host) !== -1;
  if(isRequestToArbiter) {
      options.headers = {'X-Api-Key': ARBITER_TOKEN};
      //do the request and call back when done
      console.log("[databox-request] " + options.uri);
      request(options,callback);
  } else {
      //
      // we are talking to another databox component so we need a macaroon!
      //
      macaroonCache.getMacaroon(host)
      .then((macaroon)=>{
          //do the request and call back when done
          options.headers = {'X-Api-Key': macaroon};
          console.log("[databox-request-with-macaroon] ", options.uri, options.headers);
          request(options,callback);
      })
      .catch((result)=>{
          if(result.error !== null) {
              callback(result.error,result.response,null);
              macaroonCache.invalidateMacaroon(host);
              return;
          } else if (result.response.statusCode != 200) {
              //API responded with an error
              callback(result.body,result.response,null);
              macaroonCache.invalidateMacaroon(host);
              return;
          }
      });
      
  }

};