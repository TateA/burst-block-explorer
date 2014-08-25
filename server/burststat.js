var async       = require('async');
var jsonFormat  = require('prettyjson');
var burst       = require('./burstapi');
var fs          = require('fs');

/*
 1.120 records of diff      every blocks, hourly, daily, weekly, monthly
 2.120 records of tx amount every blocks, hourly, daily, weekly, monthly
 3.120 records of tx count  every blocks, hourly, daily, weekly, monthly
 4.top 100 account with most funds (richlist)
 5.top 100 account with most block generated (top miners)
 6.top 100 account with most transactions (most active account)
 7.top 100 transaction with highest amount
 8.top 100 fastest block generated
 9.top 100 longest block generated
 10.top 100 highest block diff
 11.top 100 lowest block diff
 12.price hourly, daily, weekly, monthly
 13.distribution of block generation time (<1 secs,10,20,..,>360)
 14.distribution of account balance (<1,1k,10k,100k,1m,10m,100m,1g,>1g)
 15.distribution of transaction amount (<1,1k,10k,100k,1m,10m,100m,1g,>1g)
 */

var burstStatDiff = {
    blocks : [], //last 180 blocks
    hourly : [], //last 168 (7 days  ) 1 record ~ 15 blocks
    daily  : [], //last  90 (3 months)
    weekly : [], //last  96 (2 years )
    monthly: []  //last  60 (5 years )
};

var burstStatTxAmount = { //.totalAmountNQT
    blocks : [], //last 180 blocks
    hourly : [], //last 168 (7 days  ) 1 record ~ 15 blocks
    daily  : [], //last  90 (3 months)
    weekly : [], //last  96 (2 years )
    monthly: []  //last  60 (5 years )
};

var burstStatTxCount = { //.numberOfTransactions
    blocks : [], //last 180 blocks
    hourly : [], //last 168 (7 days  ) 1 record ~ 15 blocks
    daily  : [], //last  90 (3 months)
    weekly : [], //last  96 (2 years )
    monthly: []  //last  60 (5 years )
};

var burstStat = {
    lastBlock       : 0,
    lastBlockId     : 0,
    diff            : burstStatDiff,
    txAmount        : burstStatTxAmount,
    txCount         : burstStatTxCount,
    accMostRich     : [],
    accTopMiners    : [],
    accTopTxAmount  : [],
    accMostActive   : [],
    txTopAmount     : [],
    blkFastest      : [],
    blkSlowest      : [],
    blkHighestDiff  : [],
    blkLowestDiff   : [],
    distBlkGenTime  : [], //0...720 (+10)
    distAccBalance  : [], //0...1G (x10)
    distTxAmount    : [],  //0...1G (x10)
    init : function() {
        for(var i=this.distBlkGenTime.length ; i<20 ; i++){
            this.distBlkGenTime.push(0);
        }
        for(var i=this.distAccBalance.length ; i<9 ; i++){
            this.distAccBalance.push(0);
        }
        for(var i=this.distTxAmount.length ; i<9 ; i++){
            this.distTxAmount.push(0);
        }
    }
};

var activeAccount = {}

function processBlockRelatedTx(block){
    if(block.hasOwnProperty('transactionsData')){
        var txList = block.transactionsData;
        txList.forEach(function(tx){
            var txAmount = parseFloat(tx.amountNQT/100000000.0).toFixed(2);
            if(tx.hasOwnProperty('sender')){
                if(activeAccount .hasOwnProperty(tx.sender)){
                    var spent = parseFloat(activeAccount [tx.sender].spent) + parseFloat(txAmount);
                    activeAccount [tx.sender].spent = spent.toFixed(2);
                    activeAccount [tx.sender].txCount++;
                }
            }
            if(tx.hasOwnProperty('recipient')){
                if(activeAccount .hasOwnProperty(tx.recipient)){
                    var received = parseFloat(activeAccount [tx.recipient].received) + parseFloat(txAmount);
                    activeAccount [tx.recipient].received = received.toFixed(2);
                    activeAccount [tx.recipient].txCount++;
                }
            }

            var newTx = {
                amount : txAmount,
                transaction : tx.transaction
            };

            for( var insertNdx=0 ; insertNdx<burstStat.txTopAmount.length ; insertNdx++){
                var oldTxAmount  = parseFloat(burstStat.txTopAmount[insertNdx].amount);
                var newTxAmount  = parseFloat(newTx.amount);
                if(newTxAmount > oldTxAmount){
                    burstStat.txTopAmount.splice(insertNdx, 0, newTx);
                    break;
                }
            }
            if((insertNdx == burstStat.txTopAmount.length) && (burstStat.txTopAmount.length < 100)){
                burstStat.txTopAmount.push(newTx);
            }
            if(burstStat.txTopAmount.length > 100){
                burstStat.txTopAmount.splice(100,burstStat.txTopAmount.length-100);
            }

            if(parseFloat(newTx.amount) < 1.0){
                burstStat.distTxAmount[0] = parseInt(burstStat.distTxAmount[0]) + 1;
            }
            else if(parseFloat(newTx.amount) >= 100000000.0){
                burstStat.distTxAmount[9] = parseInt(burstStat.distTxAmount[9]) + 1;
            }
            else{
                var scale = Math.floor(log10(parseInt(newTx.amount)))+1;
                burstStat.distTxAmount[scale] = parseInt(burstStat.distTxAmount[scale]) + 1;
            }
        });
    }
}

function processBlockRelatedAccount(block, done){
    if(block.hasOwnProperty('relatedAccounts')){
        var accList = block.relatedAccounts;
        accList.forEach(function(acc){
            if(!activeAccount .hasOwnProperty(acc.account)){
                activeAccount [acc.account] = {};
                activeAccount [acc.account].firstSeenAtBlock = block.height;
                activeAccount [acc.account].txCount = 0;
                activeAccount [acc.account].spent = 0.0;
                activeAccount [acc.account].received = 0.0;
            }
            activeAccount [acc.account].data = acc;
        });
    }

    processBlockRelatedTx(block);
    processTopScore(function(){
        done();
    })
}

function log10(val){
    return Math.log(val) / Math.LN10;
}

function updateTopBalance(done){

    for(var account in activeAccount ) {
        var acc = activeAccount [account];
        var newItem = {
            balance: parseFloat(acc.data.balanceNQT / 100000000.0).toFixed(2),
            account: acc.data.account
        };

        if(parseFloat(newItem.balance) < 1.0){
            burstStat.distAccBalance[0] = parseInt(burstStat.distAccBalance[0]) + 1;
        }
        else if(parseFloat(newItem.balance) >= 100000000.0){
            burstStat.distAccBalance[9] = parseInt(burstStat.distAccBalance[9]) + 1;
        }
        else{
            var scale = Math.floor(log10(parseInt(newItem.balance)))+1;
            burstStat.distAccBalance[scale] = parseInt(burstStat.distAccBalance[scale]) + 1;
        }

        for (var insertNdx = 0; insertNdx < burstStat.accMostRich.length; insertNdx++) {
            var balance = parseFloat(burstStat.accMostRich[insertNdx].balance);
            var newBalance = parseFloat(newItem.balance);
            if (newBalance > balance) {
                burstStat.accMostRich.splice(insertNdx, 0, newItem);
                break;
            }
        }
        if ((insertNdx == burstStat.accMostRich.length) && (burstStat.accMostRich.length < 100)) {
            burstStat.accMostRich.push(newItem);
        }
        if (burstStat.accMostRich.length > 100) {
            burstStat.accMostRich.splice(100, burstStat.accMostRich.length - 100);
        }
    }
    done();
}

function updateTopMiner(done){
    for(var account in activeAccount ) {
        var acc = activeAccount [account];
        var itemMiner = {
            mined: parseFloat(acc.data.forgedBalanceNQT / 100000000.0).toFixed(2),
            account: acc.data.account
        };
        for (var insertNdx = 0; insertNdx < burstStat.accTopMiners.length; insertNdx++) {
            var oldMined = parseFloat(burstStat.accTopMiners[insertNdx].mined);
            var newMined = parseFloat(itemMiner.mined);
            if (newMined > oldMined) {
                burstStat.accTopMiners.splice(insertNdx, 0, itemMiner);
                break;
            }
        }
        if ((insertNdx == burstStat.accTopMiners.length) && (burstStat.accTopMiners.length < 100)) {
            burstStat.accTopMiners.push(itemMiner);
        }
        if (burstStat.accTopMiners.length > 100) {
            burstStat.accTopMiners.splice(100, burstStat.accTopMiners.length - 100);
        }
    }
    done();
}

function updateTopTx(done){
    for(var account in activeAccount ) {
        var acc = activeAccount [account];
        var txAmountNum = parseFloat(acc.spent) + parseFloat(acc.received);
        var itemTxAmount = {
            txAmount: txAmountNum.toFixed(2),
            account: acc.data.account
        };
        for (var insertNdx = 0; insertNdx < burstStat.accTopTxAmount.length; insertNdx++) {
            var oldTxAmount = parseFloat(burstStat.accTopTxAmount[insertNdx].txAmount);
            var newTxAmount = parseFloat(itemTxAmount.txAmount);
            if (newTxAmount > oldTxAmount) {
                burstStat.accTopTxAmount.splice(insertNdx, 0, itemTxAmount);
                break;
            }
        }
        if ((insertNdx == burstStat.accTopTxAmount.length) && (burstStat.accTopTxAmount.length < 100)) {
            burstStat.accTopTxAmount.push(itemTxAmount);
        }
        if (burstStat.accTopTxAmount.length > 100) {
            burstStat.accTopTxAmount.splice(100, burstStat.accTopTxAmount.length - 100);
        }
    }
    done();
}

function updateTopActive(done){
    for(var account in activeAccount ) {
        var acc = activeAccount [account];
        var txCount = parseInt(acc.txCount);
        var itemTxCount = {
            txCount: txCount,
            account: acc.data.account
        };
        for (var insertNdx = 0; insertNdx < burstStat.accMostActive.length; insertNdx++) {
            var oldTxCount = parseFloat(burstStat.accMostActive[insertNdx].txCount);
            var newTxCount = parseFloat(itemTxCount.txCount);
            if (newTxCount > oldTxCount) {
                burstStat.accMostActive.splice(insertNdx, 0, itemTxCount);
                break;
            }
        }
        if ((insertNdx == burstStat.accMostActive.length) && (burstStat.accMostActive.length < 100)) {
            burstStat.accMostActive.push(itemTxCount);
        }
        if (burstStat.accMostActive.length > 100) {
            burstStat.accMostActive.splice(100, burstStat.accMostActive.length - 100);
        }
    }
    done();
}

function processTopScore(done){
    burstStat.accMostRich = [];
    burstStat.accTopMiners = [];
    burstStat.accTopTxAmount = [];
    burstStat.accMostActive = [];
    burstStat.distAccBalance = [];
    for(var i=burstStat.distAccBalance.length ; i<10 ; i++){
        burstStat.distAccBalance.push(0);
    }
    async.parallel(
        {
            topBalance: function(callback){
                updateTopBalance(function(){
                    callback(null,null);
                });
            },
            topMiner : function(callback){
                updateTopMiner(function(){
                    callback(null,null);
                });
            },
            topTxAmount : function(callback){
                updateTopTx(function(){
                    callback(null,null);
                });
            },
            topTxCount : function(callback){
                updateTopActive(function(){
                    callback(null,null);
                });
            }
        },
        function(err, results){
            done();
        }
    );
}

function processDiffStat(block,done){
    function processDiffSeries(thisSeries, prevSeries, maxRecords, thisSeriesInterval){
        var recentItem = prevSeries[0];

        if(thisSeries.length <= 0){
            thisSeries.unshift(recentItem);
        }
        else {
            var secsDiff = recentItem.timestamp - thisSeries[0].timestamp;
            if(secsDiff > thisSeriesInterval){
                thisSeries.unshift(recentItem);
                if(thisSeries.length > maxRecords){
                    thisSeries.pop();
                }
            }
            else {
                var diffsum = 0;
                var ndx = 0;
                do{
                    secsDiff = recentItem.timestamp - prevSeries[ndx].timestamp
                    if(secsDiff < thisSeriesInterval){
                        diffsum += prevSeries[ndx].diff;
                        ndx++;
                    }
                }while( (secsDiff < thisSeriesInterval) && (ndx < prevSeries.length) );

                thisSeries[0].blockId    = recentItem.blockId;
                thisSeries[0].height     = recentItem.height;
                thisSeries[0].diff       = diffsum/parseFloat(ndx);
                thisSeries[0].timeLength = secsDiff;
            }
        }
    }

    var blockStatItem = {
        diff        : parseFloat(block.baseTarget),
        blockId     : block.blockId,
        blockHeight : block.height,
        timestamp   : block.timestamp,
        timeLength  : 0
    };
    burstStat.diff.blocks.unshift(blockStatItem);

    processDiffSeries(burstStat.diff.hourly , burstStat.diff.blocks, 168, 60*60);
    processDiffSeries(burstStat.diff.daily  , burstStat.diff.hourly,  90, 60*60*24);
    processDiffSeries(burstStat.diff.weekly , burstStat.diff.daily ,  96, 60*60*24*7);
    processDiffSeries(burstStat.diff.monthly, burstStat.diff.weekly, 120, 60*60*24*30);

    if(burstStat.diff.blocks.length > 180){
        burstStat.diff.blocks.pop();
    }
    done();
}

function processRoundTimeStat(block, done){
    if(block.hasOwnProperty('previousBlockData') && block.previousBlockData!=null){
        var roundTime = parseInt(block.timestamp) - parseInt(block.previousBlockData.timestamp);
        if(roundTime <= 1){
            burstStat.distBlkGenTime[0] = parseInt(burstStat.distBlkGenTime[0]) + 1;
        }
        else if(roundTime >= 1800){
            burstStat.distBlkGenTime[19] = parseInt(burstStat.distBlkGenTime[19]) + 1;
        }
        else{
            var scale = Math.floor(parseFloat(roundTime) / 100.0)+1;
            burstStat.distBlkGenTime[scale] = parseInt(burstStat.distBlkGenTime[scale]) + 1;
        }

        var item = {
            blockId: block.blockId,
            roundTime: roundTime
        };
        for (var insertNdx = 0; insertNdx < burstStat.blkFastest.length; insertNdx++) {
            var oldFastestTime = parseFloat(burstStat.blkFastest[insertNdx].roundTime);
            var newFastestTime = parseFloat(item.roundTime);
            if (newFastestTime < oldFastestTime) {
                burstStat.blkFastest.splice(insertNdx, 0, item);
                break;
            }
        }
        if ((insertNdx == burstStat.blkFastest.length) && (burstStat.blkFastest.length < 100)) {
            burstStat.blkFastest.push(item);
        }
        if (burstStat.blkFastest.length > 100) {
            burstStat.blkFastest.splice(100, burstStat.blkFastest.length - 100);
        }

        for (var insertNdx = 0; insertNdx < burstStat.blkSlowest.length; insertNdx++) {
            var oldSlowestTime = parseFloat(burstStat.blkSlowest[insertNdx].roundTime);
            var newSlowestTime = parseFloat(item.roundTime);
            if (newSlowestTime > oldSlowestTime) {
                burstStat.blkSlowest.splice(insertNdx, 0, item);
                break;
            }
        }
        if ((insertNdx == burstStat.blkSlowest.length) && (burstStat.blkSlowest.length < 100)) {
            burstStat.blkSlowest.push(item);
        }
        if (burstStat.blkSlowest.length > 100) {
            burstStat.blkSlowest.splice(100, burstStat.blkSlowest.length - 100);
        }
    }
    done();
}

function processBlockDiffStat(block, done){
    var diff = parseInt(block.baseTarget);
    var item = {
        blockId: block.blockId,
        diff: diff
    };
    for (var insertNdx = 0; insertNdx < burstStat.blkHighestDiff.length; insertNdx++) {
        var oldHighest = parseFloat(burstStat.blkHighestDiff[insertNdx].diff);
        var newHighest = parseFloat(item.diff);
        if (newHighest > oldHighest) {
            burstStat.blkHighestDiff.splice(insertNdx, 0, item);
            break;
        }
    }
    if ((insertNdx == burstStat.blkHighestDiff.length) && (burstStat.blkHighestDiff.length < 100)) {
        burstStat.blkHighestDiff.push(item);
    }
    if (burstStat.blkHighestDiff.length > 100) {
        burstStat.blkHighestDiff.splice(100, burstStat.blkHighestDiff.length - 100);
    }

    for (var insertNdx = 0; insertNdx < burstStat.blkLowestDiff.length; insertNdx++) {
        var oldLowest = parseFloat(burstStat.blkLowestDiff[insertNdx].diff);
        var newLowest = parseFloat(item.diff);
        if (newLowest < oldLowest) {
            burstStat.blkLowestDiff.splice(insertNdx, 0, item);
            break;
        }
    }
    if ((insertNdx == burstStat.blkLowestDiff.length) && (burstStat.blkLowestDiff.length < 100)) {
        burstStat.blkLowestDiff.push(item);
    }
    if (burstStat.blkLowestDiff.length > 100) {
        burstStat.blkLowestDiff.splice(100, burstStat.blkLowestDiff.length - 100);
    }
    done();
}

function processTxStat(block,done){
    function processTxSeries(thisSeries, prevSeries, maxRecords, thisSeriesInterval){
        var recentItem = prevSeries[0];

        if(thisSeries.length <= 0){
            thisSeries.unshift(recentItem);
        }
        else {
            var secsDiff = recentItem.timestamp - thisSeries[0].timestamp;
            if(secsDiff > thisSeriesInterval){
                thisSeries.unshift(recentItem);
                if(thisSeries.length > maxRecords){
                    thisSeries.pop();
                }
            }
            else {
                var txAmountSum = 0;
                var ndx = 0;
                do{
                    secsDiff = recentItem.timestamp - prevSeries[ndx].timestamp;
                    if(secsDiff < thisSeriesInterval){
                        txAmountSum += prevSeries[ndx].txAmount;
                        ndx++;
                    }
                }while( (secsDiff < thisSeriesInterval) && (ndx < prevSeries.length) );

                thisSeries[0].blockId    = recentItem.blockId;
                thisSeries[0].height     = recentItem.height;
                thisSeries[0].txAmount   = txAmountSum/parseFloat(ndx);
                thisSeries[0].timeLength = secsDiff;
            }
        }
    }

    var blockStatItem = {
        txAmount    : parseFloat(block.totalAmountNQT),
        blockId     : block.blockId,
        blockHeight : block.height,
        timestamp   : block.timestamp,
        timeLength  : 0
    };
    burstStat.txAmount.blocks.unshift(blockStatItem);

    processTxSeries(burstStat.txAmount.hourly , burstStat.txAmount.blocks, 168, 60*60);
    processTxSeries(burstStat.txAmount.daily  , burstStat.txAmount.hourly,  90, 60*60*24);
    processTxSeries(burstStat.txAmount.weekly , burstStat.txAmount.daily ,  96, 60*60*24*7);
    processTxSeries(burstStat.txAmount.monthly, burstStat.txAmount.weekly, 120, 60*60*24*30);

    if(burstStat.txAmount.blocks.length > 180){
        burstStat.txAmount.blocks.pop();
    }
    done();
}

function processTxCountStat(block,done){
    function processTxCountSeries(thisSeries, prevSeries, maxRecords, thisSeriesInterval){
        var recentItem = prevSeries[0];

        if(thisSeries.length <= 0){
            thisSeries.unshift(recentItem);
        }
        else {
            var secsDiff = recentItem.timestamp - thisSeries[0].timestamp;
            if(secsDiff > thisSeriesInterval){
                thisSeries.unshift(recentItem);
                if(thisSeries.length > maxRecords){
                    thisSeries.pop();
                }
            }
            else {
                var txCountSum = 0;
                var ndx = 0;
                do{
                    secsDiff = recentItem.timestamp - prevSeries[ndx].timestamp;
                    if(secsDiff < thisSeriesInterval){
                        txCountSum += prevSeries[ndx].txCount;
                        ndx++;
                    }
                }while( (secsDiff < thisSeriesInterval) && (ndx < prevSeries.length) );

                thisSeries[0].blockId    = recentItem.blockId;
                thisSeries[0].height     = recentItem.height;
                thisSeries[0].txCount    = txCountSum/parseFloat(ndx);
                thisSeries[0].timeLength = secsDiff;
            }
        }
    }

    var blockStatItem = {
        txCount    : parseFloat(block.numberOfTransactions),
        blockId     : block.blockId,
        blockHeight : block.height,
        timestamp   : block.timestamp,
        timeLength  : 0
    };
    burstStat.txCount.blocks.unshift(blockStatItem);

    processTxCountSeries(burstStat.txCount.hourly , burstStat.txCount.blocks, 168, 60*60);
    processTxCountSeries(burstStat.txCount.daily  , burstStat.txCount.hourly,  90, 60*60*24);
    processTxCountSeries(burstStat.txCount.weekly , burstStat.txCount.daily ,  96, 60*60*24*7);
    processTxCountSeries(burstStat.txCount.monthly, burstStat.txCount.weekly, 120, 60*60*24*30);

    if(burstStat.txCount.blocks.length > 180){
        burstStat.txCount.blocks.pop();
    }
    done();
}

function processBlock(block, done){
    console.log('processing stat block#'+block.height+' '+block.blockId);
    burstStat.lastBlock   = block.height;
    burstStat.lastBlockId = block.blockId;

    async.parallel(
        {
            diff: function(callback){
                processDiffStat(block, function(){
                   callback(null,null);
                });
            },
            tx : function(callback){
                processTxStat(block, function(){
                   callback(null, null);
                });
            },
            txCount : function(callback){
                processTxCountStat(block, function(){
                   callback(null,null);
                });
            },
            accList : function(callback){
                processBlockRelatedAccount(block, function(){
                    callback(null,null);
                });
            },
            roundTime : function(callback){
                processRoundTimeStat(block, function(){
                   callback(null,null);
                });
            },
            blockdiff : function(callback){
                processBlockDiffStat(block, function(){
                    callback(null,null);
                })
            }
        },
        function(err, results){
            done();
        }
    );
}

function getStat(){
    return burstStat;
}

function getActiveAccount(){
    return activeAccount;
}

function walkBlock(block, done){
    if(block.status === true){
        processBlock(block.message, function(){
            if(block.message.hasOwnProperty('nextBlock')){
                burst.getFullBlock(block.message.nextBlock, function(block){
                    setTimeout(function(){walkBlock(block, done)},5);
                }, false);
            }
            else{
                done();
            }
        });
    }else {
        setTimeout(function(){walkBlock(block, done)},1000);
    }
}

function update(done){
    if(burst.getClientState().lastBlock == null){
        setTimeout(function(){update(done);},1000);
    }
    else{
        var latestBlock = burst.getClientState().lastBlock;
        if(burstStat.lastBlock < latestBlock.height){
            if(burstStat.lastBlockId == 0){
                burst.getFullBlock(burst.getClientState().constant.genesisBlockId, function(block){
                    walkBlock(block,done);
                }, false);
            }
            else {
                burst.getFullBlock(burstStat.lastBlockId, function(block){
                    walkBlock(block,done);
                }, false);
            }
        }
    }
}

function init(startFile){
    fs.readFile(startFile, function(err, data){
        if(err) {
            burstStat.init();
        }
        else {
            burstStat = JSON.parse(data);
        }
    });
}

module.exports = {
    getStat: getStat,
    getActiveAccount : getActiveAccount,
    update:update,
    init:init
};