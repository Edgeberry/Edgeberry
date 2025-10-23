# Edgeberry Device Node-RED Examples

This guide shows you how to send data from your Edgeberry Device to the Device Hub using Node-RED.

## Architecture Overview

```
┌─────────────────────────────────────┐
│     Edgeberry Device                │
│                                     │
│  ┌──────────┐    D-Bus    ┌──────┐ │
│  │ Node-RED │────────────►│Device│ │
│  │  Flow    │             │ Soft │ │
│  └──────────┘             │ ware │ │
│                           └───┬──┘ │
└───────────────────────────────┼────┘
                                │ MQTT (mTLS)
                                │ Topic: $devicehub/devices/{id}/telemetry
                                ▼
┌────────────────────────────────────────┐
│        Device Hub Server               │
│                                        │
│  ┌────────┐      ┌──────────────────┐ │
│  │  MQTT  │─────►│application-service│ │
│  │ Broker │      │   (WebSocket)    │ │
│  └────────┘      └─────────┬────────┘ │
└────────────────────────────┼──────────┘
                             │ WebSocket
                             │ ws://host:8090/ws
                             ▼
┌────────────────────────────────────────┐
│   Cloud Application (Node-RED)         │
│                                        │
│  ┌──────────────┐     ┌──────────────┐│
│  │ Device Hub   │────►│  Dashboard   ││
│  │    Device    │     │   Chart      ││
│  │     Node     │     │              ││
│  └──────────────┘     └──────────────┘│
└────────────────────────────────────────┘
```

## Example 1: Send Temperature Reading

**On the Edgeberry Device:**

```javascript
// Inject node (every 10 seconds) → Function node → Edgeberry node

// Function node code:
msg.topic = "telemetry";
msg.payload = {
    temperature: 22.5 + Math.random() * 5,
    humidity: 45 + Math.random() * 10,
    pressure: 1013.25,
    timestamp: new Date().toISOString()
};
return msg;
```

## Example 2: Send Sensor Data on Event

**On the Edgeberry Device:**

```javascript
// GPIO input node → Function node → Edgeberry node

// Function node code:
msg.topic = "telemetry";
msg.payload = {
    motion_detected: true,
    sensor_id: "PIR-001",
    location: "entrance",
    timestamp: new Date().toISOString()
};
return msg;
```

## Example 3: Send Multiple Sensor Values

**On the Edgeberry Device:**

```javascript
// Multiple sensor nodes → Join node → Function node → Edgeberry node

// Function node code (after join):
msg.topic = "telemetry";
msg.payload = {
    temperature: msg.payload.temp,
    humidity: msg.payload.hum,
    pressure: msg.payload.press,
    light_level: msg.payload.light,
    device_status: "ok"
};
return msg;
```

## Example 4: Receive Data on Cloud Side

**On the Cloud/Server Node-RED:**

```javascript
// Device Hub Device node → Debug/Dashboard

// The Device node will output messages like:
{
    topic: "telemetry/EDGB-A096",
    payload: {
        deviceId: "a0963359-1234-5678-9abc-def012345678",
        timestamp: "2025-10-23T09:00:00.000Z",
        temperature: 23.7,
        humidity: 48.2,
        pressure: 1013.25
    },
    deviceName: "EDGB-A096",
    messageType: "telemetry"
}

// Filter for temperature alerts:
if (msg.messageType === "telemetry" && msg.payload.temperature > 30) {
    msg.payload = `High temperature alert: ${msg.payload.temperature}°C`;
    return msg;
}
```

## Example 5: Complete Temperature Monitoring Flow

### Device Side Flow:
```
[Inject] → [Read Sensor] → [Format Data] → [Edgeberry]
  10s         (function)      (function)
```

**Read Sensor Function:**
```javascript
// Simulate reading from sensor
msg.temperature = 20 + Math.random() * 15;
return msg;
```

**Format Data Function:**
```javascript
msg.topic = "telemetry";
msg.payload = {
    temperature: msg.temperature,
    unit: "celsius",
    sensor: "DS18B20",
    timestamp: new Date().toISOString()
};
return msg;
```

### Cloud Side Flow:
```
[Device Hub Device] → [Filter] → [Dashboard Gauge]
     (EDGB-A096)       (switch)   (temperature)
                          ↓
                     [Email Alert]
                    (if temp > 30)
```

**Filter Switch Node:**
```javascript
// Route 1: Always to dashboard
// Route 2: Only if temperature > 30
if (msg.messageType === "telemetry" && msg.payload.temperature > 30) {
    return [msg, msg];  // Send to both outputs
}
return [msg, null];  // Only to dashboard
```

## Message Format Reference

### Sending from Device to Hub

**Option 1: Set topic to "telemetry"**
```javascript
{
    "topic": "telemetry",
    "payload": {
        "sensor1": 123.4,
        "sensor2": "active",
        "status": "ok"
    }
}
```

**Option 2: Use payload.data format**
```javascript
{
    "payload": {
        "data": {
            "temperature": 22.5,
            "humidity": 45
        }
    }
}
```

### Receiving on Cloud Side

The Device Hub Device node outputs:
```javascript
{
    "topic": "telemetry/EDGB-XXXX",
    "payload": {
        "deviceId": "full-uuid-here",
        "timestamp": "ISO-8601-timestamp",
        // ... your data fields
    },
    "deviceName": "EDGB-XXXX",
    "messageType": "telemetry"
}
```

## Troubleshooting

### Device Not Sending Data

1. **Check D-Bus connection**: Run `dbus-send --system --print-reply --dest=io.edgeberry.Core /io/edgeberry/Core io.edgeberry.Core.SendMessage string:'{"test":123}'`
2. **Check device software logs**: `sudo journalctl -u edgeberry-device-software -f`
3. **Verify Node-RED has system bus access**: Ensure Node-RED runs with proper permissions

### Cloud Not Receiving Data

1. **Check application-service is running**: `sudo systemctl status devicehub-application`
2. **Verify API token is correct** in Device Hub Device node config
3. **Check device is online** in Device Hub UI
4. **Monitor MQTT topics**: `ssh user@hub "mosquitto_sub -h 127.0.0.1 -p 1883 -t '\$devicehub/devices/+/telemetry' -v"`

### Data Format Errors

If you see `err:invalid_data` in device logs:
- Ensure your payload is valid JSON
- Check that you're not sending circular references
- Verify data types are JSON-serializable (strings, numbers, booleans, objects, arrays)

## Best Practices

1. **Include Timestamps**: Always add a timestamp to your telemetry data
2. **Use Meaningful Keys**: Use descriptive field names (e.g., `temperature_celsius` not just `temp`)
3. **Add Units**: Include units in field names or as separate fields
4. **Error Handling**: Add catch nodes in your flows to handle failures gracefully
5. **Rate Limiting**: Don't send data faster than 1 message per second per device
6. **Message Size**: Keep messages under 1KB for optimal performance

## Advanced: Bidirectional Communication

You can also receive commands from the cloud:

**Cloud sends method call:**
```javascript
// In Device Hub Device node input:
{
    "action": "method",
    "methodName": "setInterval",
    "payload": { "interval": 30000 }
}
```

**Device handles method:**
The device software will receive the method call via the direct methods API.

## Related Documentation

- Device Hub API: `/Edgeberry-Device-Hub/documentation/alignment.md`
- Device Software: `/Edgeberry-device-software/README.md`
- Node-RED Device Hub nodes: `/Edgeberry-Device-Hub/examples/app-client/examples/README.md`
