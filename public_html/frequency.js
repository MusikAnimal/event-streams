/**
 * Courtesy of Andrew Otto (MIT)
 * Modified to match local linting rules.
 * https://codepen.io/ottomata/pen/VKNyEw/?editors=0010
 */

window.Frequency = function (interval, callback) {
    const freq = this;
    const rAF = window.requestAnimationFrame || setTimeout;

    this.interval = interval;
    this.callback = callback;
    this.count = 0;
    this.total = 0;
    this.since = this.start = this.now();
    function checker() {
        freq.check();
        rAF(checker);
    }
    rAF(checker);
};
window.Frequency.prototype.now = (function () {
    const perf = window.performance;
    return perf.now
        ? function () { return perf.now(); }
        : function () { return +new Date(); };
}());
window.Frequency.prototype.add = function (count) {
    this.count += count;
    this.total += count;
    this.check();
};
window.Frequency.prototype.check = function () {
    let count;
    let avg;
    let ellapsedTotal;
    const ellapsed = this.now() - this.since;
    if (ellapsed >= this.interval) {
        ellapsedTotal = this.now() - this.start;
        count = this.count;
        // One optional digit
        avg = (this.total / (ellapsedTotal / this.interval)).toFixed(1).replace('.0', '');
        this.since = this.now();
        this.count = 0;
        this.callback(count, avg);
    }
};
