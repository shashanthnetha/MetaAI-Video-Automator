import asyncio
import json
from websockets.asyncio.server import serve

clients = set()


async def handler(websocket):
    print("\n✅ Extension connected!")
    clients.add(websocket)

    try:
        async for message in websocket:
            print(f"\n📨 Received: {message}")

            data = json.loads(message)

            # Extension handshake
            if data.get("type") == "HELLO":
                print("👋 HELLO received from extension")

                await websocket.send(json.dumps({
                    "type": "PING"
                }))

                print("🏓 PING sent")

            # Extension replied to our ping
            elif data.get("type") == "PONG":
                print("✅ PONG received!")
                print("🎉 Connection established!")

                print("\n⏳ Waiting 2 seconds before sending GENERATE...")
                await asyncio.sleep(2)

                generate_payload = {
                    "id": "job001",
                    "type": "GENERATE",
                    "provider": "meta",
                    "mode": "text",
                    "prompt": "A cinematic drone shot of a futuristic city at sunset."
                }

                await websocket.send(json.dumps(generate_payload))

                print("🚀 GENERATE request sent!")
                print(json.dumps(generate_payload, indent=2))

            # ACK from extension
            elif data.get("type") == "ACK":
                print("✅ ACK received!")

            # STATUS updates
            elif data.get("type") == "STATUS":
                print(f"📊 STATUS → {data.get('status')}")

            # ERROR messages
            elif data.get("type") == "ERROR":
                print(f"❌ ERROR → {data.get('message')}")

            else:
                print(f"ℹ️ Other message: {data}")

    except Exception as e:
        print(f"\n❌ Connection closed: {e}")

    finally:
        clients.discard(websocket)


async def main():
    print("🚀 WebSocket Server starting...")
    print("📡 Listening on ws://localhost:8765\n")

    async with serve(handler, "localhost", 8765):
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())