import asyncio
import json
import websockets

# 設定
UDP_IP = "0.0.0.0"   # すべての接続を受け入れる
UDP_PORT = 50000     # スマホの送信先ポート
WS_PORT = 8765       # ブラウザが接続するポート

# 接続されているブラウザ（クライアント）を記録するリスト
connected_clients = set()

# 実際のZIG SIMペイロード {"sensordata":{"accel":{"x":..},"gyro":{...}}} から値を取り出す関数
def extract_vector(data, prefix):
    sensordata = data.get('sensordata', data) if isinstance(data, dict) else {}
    nested = sensordata.get(prefix) if isinstance(sensordata, dict) else None
    if isinstance(nested, dict):
        return (
            float(nested.get('x', 0) or 0),
            float(nested.get('y', 0) or 0),
            float(nested.get('z', 0) or 0),
        )
    # フラット形式 {"accel.x":..} への対応（保険）
    flat = sensordata if isinstance(sensordata, dict) else {}
    return (
        float(flat.get(f'{prefix}.x', 0) or 0),
        float(flat.get(f'{prefix}.y', 0) or 0),
        float(flat.get(f'{prefix}.z', 0) or 0),
    )

# 受信データの加速度・ジャイロ値をコンソールに1行で表示する関数（受信確認用）
def print_sensor_debug(message):
    try:
        data = json.loads(message)
    except (ValueError, TypeError):
        return
    ax, ay, az = extract_vector(data, 'accel')
    gx, gy, gz = extract_vector(data, 'gyro')
    line = (
        f"【加速度】X: {ax:5.2f}, Y: {ay:5.2f}, Z: {az:5.2f} [G]"
        f"　【ジャイロ】X: {gx:5.2f}, Y: {gy:5.2f}, Z: {gz:5.2f} [rad/s]"
    )
    print("\r" + line, end="", flush=True)

# WebSocketの接続・切断を管理
async def ws_handler(websocket):
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed() # ブラウザが閉じるまで待機
    finally:
        connected_clients.remove(websocket)

# UDPデータを受信したときの処理
class UDPReceiverProtocol(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        message = data.decode('utf-8')

        print_sensor_debug(message)

        # 受信したデータを、接続されているすべてのブラウザに転送
        if connected_clients:
            asyncio.create_task(broadcast(message))

# すべてのブラウザに一斉送信
async def broadcast(message):
    if connected_clients:
        await asyncio.gather(
            *[client.send(message) for client in connected_clients], 
            return_exceptions=True
        )

async def main():
    print(f"--- サーバー起動 ---")
    print(f"ポート {UDP_PORT} でデータを受信中...")
    print(f"スマホアプリ(ZIG SIM)の [START] を押してください。")
    print(f"終了するには Ctrl+C を押してください。")
    print()

    # WebSocketサーバーをバックグラウンドで起動
    # "localhost"だけにバインドすると、ゲーム画面をローカルIP(例: http://192.168.x.x/)
    # で開いた場合にブラウザから接続できなくなるため、全インターフェースで待ち受ける
    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
        # UDPサーバーを起動
        loop = asyncio.get_running_loop()
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: UDPReceiverProtocol(),
            local_addr=(UDP_IP, UDP_PORT)
        )
        try:
            await asyncio.Future()  # 永続的に実行
        finally:
            transport.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nサーバーを停止しました。")