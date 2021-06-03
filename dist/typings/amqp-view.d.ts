import AMQPProperties from "./protocol/amqp-properties.js";
/**
 * An extended DataView, with AMQP protocol specific methods
 * @ignore
 */
export default class AMQPView extends DataView {
    getUint64(byteOffset: number, littleEndian?: boolean): number;
    setUint64(byteOffset: number, value: number, littleEndian?: boolean): void;
    getInt64(byteOffset: number, littleEndian?: boolean): number;
    setInt64(byteOffset: number, value: number, littleEndian?: boolean): void;
    getShortString(byteOffset: number): [string, number];
    setShortString(byteOffset: number, string: string): number;
    getLongString(byteOffset: number, littleEndian?: boolean): [string, number];
    setLongString(byteOffset: number, string: string, littleEndian?: boolean): number;
    getProperties(byteOffset: number, littleEndian?: boolean): [AMQPProperties, number];
    setProperties(byteOffset: number, properties: AMQPProperties, littleEndian?: boolean): number;
    getTable(byteOffset: number, littleEndian?: boolean): [Record<string, unknown>, number];
    setTable(byteOffset: number, table: object, littleEndian?: boolean): number;
    getField(byteOffset: number, littleEndian?: boolean): [string | number | boolean | object, number];
    setField(byteOffset: number, field: any, littleEndian?: boolean): number;
    getArray(byteOffset: number, littleEndian?: boolean): [any[], number];
    setArray(byteOffset: number, array: any[], littleEndian?: boolean): number;
    getByteArray(byteOffset: number): [Uint8Array, number];
    setByteArray(byteOffset: number, data: Uint8Array): number;
    setFrameEnd(j: number): 1;
}
//# sourceMappingURL=amqp-view.d.ts.map