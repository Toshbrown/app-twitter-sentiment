
/*jshint esversion: 6 */
var https = require('https');
var express = require("express");
var bodyParser = require("body-parser");
var url = require("url");
var fs = require("fs");
var sentiment = require('sentiment');


//The endpoint for my datastore (Where i can publish my sentiment data)
const DATABOX_STORE_BLOB_ENDPOINT = process.env.DATABOX_STORE_ENDPOINT || '';

//The endpoint for the datasource requested in the manifest ( env var name derived from the id in the manifest)
var DATASOURCE_DS_twitterUserTimeLine = JSON.parse(process.env.DATASOURCE_DS_twitterUserTimeLine || '{}');
var DATASOURCE_DS_testActuator = JSON.parse(process.env.DATASOURCE_DS_testActuator  || '{}');
var testActuatorUSER_ENDPOINT = DATASOURCE_DS_twitterUserTimeLine.href || '';
const USER_TIMELINE_ENDPOINT = DATASOURCE_DS_twitterUserTimeLine.href || '';

//The endpoint for the datasource requested in the manifest ( env var name derived from the id in the manifest)
var DATASOURCE_DS_twitterHashTagStream = JSON.parse(process.env.DATASOURCE_DS_twitterHashTagStream || '{}');
console.log(DATASOURCE_DS_twitterHashTagStream);
const HASHTAG_ENDPOINT = DATASOURCE_DS_twitterHashTagStream.href || '';
console.log(HASHTAG_ENDPOINT);

//My https cred generated by the container manager
const HTTPS_SECRETS = JSON.parse( fs.readFileSync("/run/secrets/DATABOX_PEM") );
var credentials = {
  key:  HTTPS_SECRETS.clientprivate || '',
  cert: HTTPS_SECRETS.clientcert || '',
};		


var app = express();

var status = "init";
app.get("/status", function(req, res) {
    res.send(status);
});

var latestTweet = {tweet:"No tweets received yet ...."};
app.get("/ui", function(req, res) {
    res.send("<html><script>setTimeout(function(){window.location.reload,2000);};</script><body><h2><pre>" + JSON.stringify(latestTweet, null, 4) + "</pre></h2></body></html>");
});

app.get("/ui/acctest", function(req, res) {
    var endpointUrl = url.parse(testActuatorUSER_ENDPOINT);
    var dsID = DATASOURCE_DS_testActuator['item-metadata'].filter((itm)=>{return itm.rel === 'urn:X-databox:rels:hasDatasourceid'; })[0].val;
    var dsUrl = endpointUrl.protocol + '//' + endpointUrl.host;        
    databox.timeseries.write(dsUrl,dsID,{'test':'ing 123'})
    .then((body)=>{
        res.send("<h2>OK > " + body + "</h2>");
    })
    .catch((error)=>{
        res.send("<h2>ERROR::" + error + "</h2>");
    });
});

//start the express server
https.createServer(credentials, app).listen(8080);

//
// wait for our data stores to be ready
//
console.log("waiting for DATABOX_STORE_BLOB_ENDPOINT", DATABOX_STORE_BLOB_ENDPOINT),
databox.waitForStoreStatus(DATABOX_STORE_BLOB_ENDPOINT,'active')
  .then(() =>{

      //let everyone know that I'm ready
      status = "active";

      //Register my sentiment datasource with my store to make it available to other apps
      console.log("Registering sentiment datasource");
      proms = [
          databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
                description: 'Twitter user timeline sentiment',
                contentType: 'text/json',
                vendor: 'Databox Inc.',
                type: 'twitterUserTimelineSentiment',
                datasourceid: 'twitterUserTimelineSentiment',
                storeType: 'store-json',
            }),
            databox.catalog.registerDatasource(DATABOX_STORE_BLOB_ENDPOINT, {
                description: 'Twitter hash tag sentiment',
                contentType: 'text/json',
                vendor: 'Databox Inc.',
                type: 'twitterHashTagSentiment',
                datasourceid: 'twitterHashTagSentiment',
                storeType: 'store-json',
            })
      ];
    return Promise.all(proms);

  })
  .then(()=>{

      //register for live streaming data from the driver-twitter
      console.log("subscribing to datasources:", USER_TIMELINE_ENDPOINT, HASHTAG_ENDPOINT);

      var dataEmitter = null; 

      if(USER_TIMELINE_ENDPOINT !== '') {

        var endpointUrl = url.parse(USER_TIMELINE_ENDPOINT);
        var dsID = DATASOURCE_DS_twitterUserTimeLine['item-metadata'].filter((itm)=>{return itm.rel === 'urn:X-databox:rels:hasDatasourceid'; })[0].val;
        var dsUrl = endpointUrl.protocol + '//' + endpointUrl.host;
        databox.timeseries.latest(dsUrl, dsID)
        .then((data)=>{
            latestTweet = { tweet:data[0].data.text, sentiment:sentiment(data.text) };
        })
        .catch((err)=>{
            console.log("[Error getting timeseries.latest]",dsUrl, dsID);
        });

        databox.subscriptions.connect(USER_TIMELINE_ENDPOINT)
        .then((emitter)=>{
            dataEmitter = emitter;      


            var endpointUrl = url.parse(USER_TIMELINE_ENDPOINT);
            var dsID = DATASOURCE_DS_twitterUserTimeLine['item-metadata'].filter((itm)=>{return itm.rel === 'urn:X-databox:rels:hasDatasourceid'; })[0].val;
            var dsUrl = endpointUrl.protocol + '//' + endpointUrl.host;
            console.log("[subscribing]",dsUrl,dsID);
            databox.subscriptions.subscribe(dsUrl,dsID,'ts')
            .catch((err)=>{console.log("[ERROR subscribing]",err);});

            endpointUrl = url.parse(HASHTAG_ENDPOINT);
            dsID = DATASOURCE_DS_twitterHashTagStream['item-metadata'].filter((itm)=>{return itm.rel === 'urn:X-databox:rels:hasDatasourceid'; })[0].val;
            dsUrl = endpointUrl.protocol + '//' + endpointUrl.host;
            console.log("[subscribing]",dsUrl,dsID);
            databox.subscriptions.subscribe(dsUrl,dsID,'ts')
            .catch((err)=>{console.log("[ERROR subscribing]",err)});

            dataEmitter.on('data',(hostname, dsID, data)=>{
                latestTweet = { tweet:data.text, sentiment:sentiment(data.text) };
                databox.export.longpoll('https://export.amar.io/', { location: data.user.location, sentiment: sentiment(data.text) });
            });


            dataEmitter.on('error',(error)=>{
                console.log(error);
            });

        })
        .catch((err)=>{console.log("[Error] connecting ws endpoint ",err);});
      }
  })
  .catch((error)=>{
      status="error";
      console.log("[ERROR]",error);
  });

module.exports = app;
