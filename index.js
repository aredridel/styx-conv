var net = require('net');
var stream = require('stream');
var util = require('util');

var NOTAG = 0xFFFF;
var NOFID = 0xFFFFFFFF;
var NOUID = -1;
var IOHDRSIZE = 24;

var types = {
    /* 9P2000.u */
    98: 'Topenfd',
    99: 'Ropenfd',

    /* 9P2000 */
    100: { name: 'Tversion', parse: parseVersion },
    101: 'Rversion',
    102: 'Tauth',
    103: 'Rauth',
    104: 'Tattach',
    105: 'Rattach',
    106: 'Terror', /* illegal */
    107: 'Rerror',
    108: 'Tflush',
    109: 'Rflush',
    110: 'Twalk',
    111: 'Rwalk',
    112: 'Topen',
    113: 'Ropen',
    114: 'Tcreate',
    115: 'Rcreate',
    116: 'Tread',
    117: 'Rread',
    118: 'Twrite',
    119: 'Rwrite',
    120: 'Tclunk',
    121: 'Rclunk',
    122: 'Tremove',
    123: 'Rremove',
    124: 'Tstat',
    125: 'Rstat',
    126: 'Twstat',
    127: 'Rwstat',
    128: 'Tmax'
}

function P9Stream(options) {
    if (!(this instanceof P9Stream)) return new P9Stream(options);
    if (!options) options = {};
    if (!options.objectMode) options.objectMode = true;

    stream.Transform.call(this, options);

    this._buffer = new Buffer(0);
}

util.inherits(P9Stream, stream.Transform);

P9Stream.prototype._transform = function(chunk, encoding, callback) {
    var packetLen;

    console.log(chunk);

    this._buffer = Buffer.concat([this._buffer, chunk]);

    if (this._buffer.length > 4 &&
        (packetLen = this._buffer.readUInt32LE(0)) <= this._buffer.length
    ) {
        this.push(convS2M(this._buffer));
        this._buffer = this._buffer.slice(packetLen);
    }
}

function convS2M(buffer) {
    var out = {};

    out.size = buffer.readUInt32LE(0);
    out.type = buffer.readUInt8(4);
    out.typeName = types[out.type].name;
    out.tag = buffer.readUInt16LE(5);
    types[out.type].parse(buffer, out);
    return out;
}

function parseVersion(buffer, out) {
    out.msize = buffer.readUInt32LE(7);
    out.version = parseString(buffer, 11);
}

function parseString(buffer, offset) {
    var length = buffer.readUInt16LE(offset);
    return buffer.slice(offset + 2, offset + 2 + length).toString('utf8');
}

net.createServer({}, function (conn) {
    console.log('connection');

    var p9 = new P9Stream();
    conn.pipe(p9);
    p9.on('readable', function() {
        console.log(p9.read());
    });
}).listen(9999, '::');
