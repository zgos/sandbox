const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');

const constants = require('./constants');

const KYBER_PRECISION = 18;

function Model(exchange) {
    this.graph = new Map();
    this.exchange = exchange;
}

Model.prototype.updateRate = function(exchange, src, dst, exchRate) {
    if (exchRate == 0) {
        return;
    }

    if (!this.graph.has(src)) {
        this.graph.set(src, new Map());
    }

    this.graph.get(src).set(dst, exchRate);
};

Model.prototype.trade = function(src, dst, exchRate, srcAmount) {
    // Returns dst amount
    if (dst.decimals.gte(src.decimals)) {
        return srcAmount.mul(exchRate).mul(constants.TEN.pow(dst.decimals - src.decimals)).div(constants.TEN.pow(KYBER_PRECISION));
    } else {
        return srcAmount.mul(exchRate).div(constants.TEN.pow(src.decimals - dst.decimals + KYBER_PRECISION));
    }
}

Model.prototype.calcBestRate = function(src0, src, srcAmount, n, route) {
    if (!this.graph.has(src)) {
        var self = this;
        this.exchange.getExchangeRate(src, src0, srcAmount).then( function(exchRate) {
            self.updateRate(self.exchange, src, src0, exchRate);
        });

        return [];
    }

    if (n <= 0) {
        if (!this.graph.get(src).has(src0)) {
            return [];
        }

        var exchRate = this.graph.get(src).get(src0);

        var src0Amount = this.trade(src, src0, exchRate, srcAmount);

        return [...route, {
            src: src,
            srcAmount: srcAmount,
            dst: src0,
            dstAmount: src0Amount,
            exchRate: exchRate,
        }];
    }

    var bestRoute = [];
    var bestReturn = src == src0 ? srcAmount : route[0].srcAmount; // Must exceed starting amount

    for (const [dst, exchRate] of this.graph.get(src)) {
        if (route.findIndex(function(t) { return t.src == dst; }) != -1) {
            continue;
        }

        var dstAmount = this.trade(src, dst, exchRate, srcAmount);

        var dstRoute = this.calcBestRate(src0, dst, dstAmount, n - 1, [...route, {
            src: src,
            srcAmount: srcAmount,
            dst: dst,
            dstAmount: dstAmount,
            exchRate: exchRate,
        }]);

        if (dstRoute.length == 0) {
            continue;
        }

        assert(dstRoute[dstRoute.length -1].dst == src0);

        var src0Return = dstRoute[dstRoute.length - 1].dstAmount;

        if (src0Return.gte(bestReturn)) {
            bestRoute = dstRoute; 
            bestReturn = src0Return;  
        }
    }

    return bestRoute;
}

Model.prototype.findBestRate = function() {
    var bestProfit = 0;

    for (const [src, dsts] of this.graph) {
        if (src.price == 0) {
            continue;
        }

        let srcValueUSD = 100;

        let srcAmount = ethers.BigNumber.from(String(Math.floor(srcValueUSD / src.price * (10**src.decimals)))); // Careful

        var bestRoute = this.calcBestRate(src, src, srcAmount, 2, []);

        if (bestRoute.length == 0) {
            continue;
        }

        assert(bestRoute[0].src == bestRoute[bestRoute.length - 1].dst);

        bestRoute.forEach( function(trade) {
            let srcAmountFmt = trade.src.formatAmount(trade.srcAmount).padEnd(constants.DISPLAY_PADDING);
            let dstAmountFmt = trade.dst.formatAmount(trade.dstAmount).padEnd(constants.DISPLAY_PADDING);
            let exchRateFmt = (trade.exchRate / (10**18)).toFixed(constants.DISPLAY_DECIMALS).padEnd(constants.DISPLAY_PADDING);

            console.log(`=> ${srcAmountFmt}\t${trade.src.symbol}\t@${exchRateFmt}\t=>\t${dstAmountFmt}\t${trade.dst.symbol}`);
        });

        var profit = bestRoute[bestRoute.length - 1].dstAmount - bestRoute[0].srcAmount;
        var profitFmt = src.formatAmount(profit).padEnd(constants.DISPLAY_PADDING);
        var profitUSDFmt = (Number(profitFmt) * src.price).toFixed(2);

        var colorFmt = profit > 0 ? constants.CONSOLE_GREEN : constants.CONSOLE_RED;
        console.log(colorFmt, `++ ${profitFmt}\t${src.symbol}\t$${profitUSDFmt}`);

        console.log(`--------------------------------------------------------------------------------`);
    }    
}

module.exports = {
    Model: Model
}