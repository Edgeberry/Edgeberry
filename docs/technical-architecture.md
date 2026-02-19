# Technical Architecture Documentation

## System Architecture Overview

The Edgeberry Device Software follows a modular, service-oriented architecture designed for reliability and maintainability on resource-constrained IoT devices.

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Layer (AWS IoT Core)               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   Device Shadow │  │   MQTT Broker   │  │ Fleet Mgmt   │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                │
                          ┌─────┴─────┐
                          │    TLS    │
                          │   MQTT    │
                          └─────┬─────┘
┌─────────────────────────────────────────────────────────────┐
│                    Device Layer (Linux)                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Edgeberry Core Service                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │ AWS Client  │  │State Manager│  │ System Service  │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │D-Bus Interface│ │Settings Store│ │Direct Methods  │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                │                             │
│  ┌─────────────────────────────┼─────────────────────────────┐ │
│  │           System APIs       │      Hardware Layer        │ │
│  │  ┌─────────┐ ┌─────────┐   │   ┌─────────┐ ┌─────────┐  │ │
│  │  │ systemd │ │  D-Bus  │   │   │  GPIO   │ │  I2C    │  │ │
│  │  └─────────┘ └─────────┘   │   └─────────┘ └─────────┘  │ │
│  └─────────────────────────────┼─────────────────────────────┘ │
│                                │                             │
│  ┌─────────────────────────────┼─────────────────────────────┐ │
│  │        User Applications    │     Hardware Components     │ │
│  │  ┌─────────┐ ┌─────────┐   │   ┌─────────┐ ┌─────────┐  │ │
│  │  │Python SDK│ │CLI Tool │   │   │Status LED│ │ Buzzer  │  │ │
│  │  └─────────┘ └─────────┘   │   └─────────┘ └─────────┘  │ │
│  │  ┌─────────┐               │   ┌─────────┐ ┌─────────┐  │ │
│  │  │Custom App│               │   │User Btn │ │ EEPROM  │  │ │
│  │  └─────────┘               │   └─────────┘ └─────────┘  │ │
│  └─────────────────────────────┼─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Components Deep Dive

### 1. AWS Client (`aws.client.ts`)

**Purpose**: Manages all AWS IoT Core interactions including connection lifecycle, MQTT operations, and device shadow management.

**Key Responsibilities**:
- Establish and maintain secure MQTT connection to AWS IoT Core
- Handle certificate-based authentication (X.509)
- Implement fleet provisioning workflow
- Manage device shadow synchronization
- Process incoming MQTT messages and direct methods
- Handle connection failures and automatic reconnection

**Critical Implementation Details**:
```typescript
// Connection configuration
const connectionConfig = {
    endpoint: process.env.AWS_IOT_ENDPOINT,
    clientId: deviceUuid,
    certificatePath: '/etc/edgeberry/certificates/device.pem.crt',
    privateKeyPath: '/etc/edgeberry/certificates/private.pem.key',
    rootCAPath: '/etc/edgeberry/certificates/root-CA.crt'
};

// Shadow topics
const shadowTopics = {
    update: `$aws/things/${deviceId}/shadow/update`,
    updateAccepted: `$aws/things/${deviceId}/shadow/update/accepted`,
    updateRejected: `$aws/things/${deviceId}/shadow/update/rejected`,
    get: `$aws/things/${deviceId}/shadow/get`,
    getAccepted: `$aws/things/${deviceId}/shadow/get/accepted`
};
```

### 2. State Manager (`state.manager.ts`)

**Purpose**: Centralized state management system that maintains device state consistency between local storage and AWS device shadow.

**State Structure**:
```typescript
interface DeviceState {
    device: {
        uuid: string;
        name: string;
        version: string;
        status: 'online' | 'offline' | 'provisioning' | 'error';
        lastSeen: string;
        uptime: number;
    };
    system: {
        cpuUsage: number;
        memoryUsage: number;
        diskUsage: number;
        temperature: number;
        networkStatus: 'connected' | 'disconnected';
    };
    applications: Array<{
        name: string;
        version: string;
        status: 'ok' | 'warning' | 'error' | 'critical';
        message: string;
        lastUpdate: string;
    }>;
    hardware: {
        ledStatus: 'on' | 'off' | 'blinking' | 'fast-blink';
        buzzerActive: boolean;
        buttonPressed: boolean;
        eepromData: any;
    };
}
```

### 3. D-Bus Interface (`dbus.interface.ts`)

**Purpose**: Provides inter-process communication API for local applications to interact with the Edgeberry core service.

**D-Bus Service Specification**:
```xml
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="io.edgeberry.Core">
    <method name="SetApplicationInfo">
      <arg direction="in" name="info" type="s"/>
    </method>
    <method name="SetApplicationStatus">
      <arg direction="in" name="status" type="s"/>
    </method>
    <method name="GetDeviceStatus">
      <arg direction="out" name="status" type="s"/>
    </method>
    <signal name="DeviceStateChanged">
      <arg name="state" type="s"/>
    </signal>
  </interface>
</node>
```

### 4. System Service (`system.service.ts`)

**Purpose**: Hardware abstraction layer that manages all physical device interactions including GPIO, I2C, and hardware-specific operations.

**Hardware Mappings**:
```typescript
const HardwareConfig = {
    gpio: {
        statusLed: 18,      // GPIO pin for status LED
        buzzer: 19,         // GPIO pin for buzzer
        userButton: 20      // GPIO pin for user button
    },
    i2c: {
        eepromAddress: 0x50, // I2C address for HAT EEPROM
        busNumber: 1         // I2C bus number
    },
    patterns: {
        led: {
            normal: { on: 1000, off: 0 },
            connecting: { on: 500, off: 500 },
            error: { on: 100, off: 100 },
            provisioning: { on: 200, off: 800 }
        },
        buzzer: {
            startup: [200, 100, 200],
            button: [100],
            error: [100, 100, 100, 100, 100]
        }
    }
};
```

## Data Flow Architecture

### 1. Device State Synchronization Flow
```
Local State Change → State Manager → AWS Shadow Update → Cloud Confirmation
                                  ↓
                            D-Bus Signal → Local Applications
```

### 2. Remote Command Flow
```
AWS IoT Core → Direct Method → Command Handler → System Action → State Update
                                              ↓
                                        Response → AWS IoT Core
```

### 3. Application Integration Flow
```
User Application → D-Bus Call → Core Service → State Update → Shadow Sync
                                            ↓
                                      Confirmation → Application
```

## Security Architecture

### Certificate Management
- **Device Certificate**: Unique X.509 certificate per device
- **Private Key**: Securely stored, never transmitted
- **Root CA**: AWS IoT Root CA for server verification
- **Certificate Rotation**: Automated renewal process

### Access Control
- **D-Bus Permissions**: Restricted to authorized users/groups
- **File Permissions**: Certificates readable only by edgeberry service
- **Network Security**: TLS 1.2+ for all communications
- **AWS Policies**: Device-specific IoT policies

## Performance Considerations

### Resource Optimization
- **Memory Usage**: Target <50MB RAM usage
- **CPU Usage**: <5% average CPU on Raspberry Pi 3+
- **Network**: Efficient MQTT message batching
- **Storage**: Minimal disk I/O, efficient state persistence

### Scalability
- **Connection Pooling**: Single MQTT connection for all operations
- **Message Queuing**: Local buffering during network outages
- **State Caching**: In-memory state with periodic persistence
- **Hardware Polling**: Optimized polling intervals

## Error Handling & Recovery

### Connection Resilience
- **Automatic Reconnection**: Exponential backoff strategy
- **Offline Queuing**: Store messages during disconnection
- **Health Monitoring**: Continuous connection health checks
- **Fallback Mechanisms**: Local operation during cloud outages

### Hardware Fault Tolerance
- **GPIO Error Handling**: Graceful degradation if hardware unavailable
- **I2C Communication**: Retry logic for EEPROM reads
- **Sensor Failures**: Continue operation with reduced functionality
- **Watchdog Integration**: System-level fault recovery

This architecture ensures reliable, scalable, and maintainable IoT device software suitable for production deployments.
