import AMQPBaseClient from './amqp-base-client.js';
import AMQPError from './amqp-error.js';
import AMQPView from './amqp-view.js';
import * as net from 'net';
import * as tls from 'tls';
import * as process from 'process';
/**
 * AMQP 0-9-1 client over TCP socket.
 * @param url - uri to the server, example: amqp://user:passwd@localhost:5672/vhost
 */
export default class AMQPClient extends AMQPBaseClient {
    constructor(url) {
        const u = new URL(url);
        const vhost = decodeURIComponent(u.pathname.slice(1)) || "/";
        const username = u.username || "guest";
        const password = u.password || "guest";
        const name = u.searchParams.get("name");
        const platform = `${process.release.name} ${process.version} ${process.platform} ${process.arch}`;
        super(vhost, username, password, name, platform);
        this.tls = u.protocol === "amqps:";
        this.host = u.host || "localhost";
        this.port = u.port || this.tls ? 5671 : 5672;
    }
    /**
     * Try establish a connection
     * @returns
     */
    connect() {
        const socket = this.tls ? this.connectTLS() : this.connectPlain();
        Object.defineProperty(this, 'socket', {
            value: socket,
            enumerable: false // hide it from console.log etc.
        });
        return new Promise((resolve, reject) => {
            this.socket.on('error', (err) => reject(new AMQPError(err.message, this)));
            this.connectPromise = [resolve, reject];
        });
    }
    /**
     * @ignore
     * Sends a set of bytes to the AMQP server
     * @param bytes
     * @returns
     */
    send(bytes) {
        return new Promise((resolve, reject) => {
            this.socket.write(bytes, (err) => err ? reject(err) : resolve(""));
        });
    }
    /**
     * @ignore
     * Closes the connection.
     */
    closeSocket() {
        this.socket.end();
    }
    connectPlain() {
        const socket = net.connect({
            host: this.host,
            port: this.port
        });
        socket.on('connect', () => {
            const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]);
            this.send(amqpstart);
        });
        return this.socketOnData(socket);
    }
    connectTLS() {
        const socket = tls.connect({
            host: this.host,
            port: this.port,
            servername: this.host,
        });
        socket.on('secureConnect', () => {
            const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]);
            this.send(amqpstart);
        });
        return this.socketOnData(socket);
    }
    socketOnData(socket) {
        let framePos = 0;
        let frameSize = 0;
        const frameBuffer = new Uint8Array(4096);
        socket.on('data', (buf) => {
            // Find frame boundaries and only pass a single frame at a time
            let bufPos = 0;
            while (bufPos < buf.byteLength) {
                // read frame size of next frame
                if (frameSize === 0)
                    frameSize = buf.readInt32BE(bufPos + 3) + 8;
                const leftOfFrame = frameSize - framePos;
                const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + leftOfFrame);
                framePos += copied;
                bufPos += copied;
                if (framePos === frameSize) {
                    const view = new AMQPView(frameBuffer.buffer, 0, frameSize);
                    this.parseFrames(view);
                    frameSize = framePos = 0;
                }
            }
        });
        return socket;
    }
}
