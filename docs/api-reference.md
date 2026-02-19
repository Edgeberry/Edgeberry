# API Reference Documentation

## D-Bus API (`io.edgeberry.Core`)

The Edgeberry Device Software exposes a D-Bus interface for local applications to interact with the core service.

### Service Information
- **Service Name**: `io.edgeberry.Core`
- **Object Path**: `/io/edgeberry/Core`
- **Interface**: `io.edgeberry.Core`
- **Bus Type**: System Bus

### Methods

#### SetApplicationInfo
Register or update application information with the Edgeberry core service.

**Signature**: `SetApplicationInfo(s) -> ()`
**Parameters**:
- `info` (string): JSON string containing application information

**JSON Schema**:
```json
{
  "name": "string",        // Application name (required)
  "version": "string",     // Application version (required)
  "description": "string"  // Application description (optional)
}
```

**Example Usage**:
```bash
# Using dbus-send
dbus-send --system --type=method_call \
  --dest=io.edgeberry.Core \
  /io/edgeberry/Core \
  io.edgeberry.Core.SetApplicationInfo \
  string:'{"name":"MyApp","version":"1.0.0","description":"My IoT Application"}'
```

```python
# Using Python SDK
from edgeberry import EdgeberrySDK

sdk = EdgeberrySDK()
sdk.set_application_info("MyApp", "1.0.0", "My IoT Application")
```

#### SetApplicationStatus
Update the current status of an application.

**Signature**: `SetApplicationStatus(s) -> ()`
**Parameters**:
- `status` (string): JSON string containing status information

**JSON Schema**:
```json
{
  "status": "ok|warning|error|critical",  // Status level (required)
  "message": "string"                     // Status message (optional)
}
```

**Status Levels**:
- `ok`: Application running normally
- `warning`: Application has minor issues but continues to function
- `error`: Application has errors but may recover
- `critical`: Application has critical errors requiring intervention

**Example Usage**:
```bash
# Using dbus-send
dbus-send --system --type=method_call \
  --dest=io.edgeberry.Core \
  /io/edgeberry/Core \
  io.edgeberry.Core.SetApplicationStatus \
  string:'{"status":"ok","message":"Application running normally"}'
```

```python
# Using Python SDK
from edgeberry import EdgeberrySDK

sdk = EdgeberrySDK()
sdk.set_application_status("ok", "Application running normally")
```

#### GetDeviceStatus
Retrieve current device status information.

**Signature**: `GetDeviceStatus() -> (s)`
**Returns**:
- `status` (string): JSON string containing device status

**Response Schema**:
```json
{
  "device": {
    "uuid": "string",
    "name": "string", 
    "version": "string",
    "status": "online|offline|provisioning|error",
    "lastSeen": "ISO8601 timestamp",
    "uptime": "number (seconds)"
  },
  "system": {
    "cpuUsage": "number (percentage)",
    "memoryUsage": "number (percentage)", 
    "diskUsage": "number (percentage)",
    "temperature": "number (celsius)",
    "networkStatus": "connected|disconnected"
  },
  "applications": [
    {
      "name": "string",
      "version": "string",
      "status": "ok|warning|error|critical",
      "message": "string",
      "lastUpdate": "ISO8601 timestamp"
    }
  ]
}
```

### Signals

#### DeviceStateChanged
Emitted when the device state changes significantly.

**Signature**: `DeviceStateChanged(s)`
**Parameters**:
- `state` (string): JSON string containing the new device state

**Example Listener**:
```python
import dbus
from dbus.mainloop.glib import DBusGMainLoop

def on_state_changed(state):
    print(f"Device state changed: {state}")

DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
bus.add_signal_receiver(
    on_state_changed,
    dbus_interface="io.edgeberry.Core",
    signal_name="DeviceStateChanged"
)
```

## CLI Interface (`edgeberry` command)

The Edgeberry CLI provides command-line access to device management functions.

### Available Commands

#### help
Display help information and available commands.

```bash
sudo edgeberry --help
sudo edgeberry help [command]
```

#### status
Display current device status and connection information.

```bash
sudo edgeberry status
```

**Output Example**:
```
Edgeberry Device Status
=======================
Device UUID: 550e8400-e29b-41d4-a716-446655440000
Status: online
Version: 2.8.2
Uptime: 2 days, 14 hours, 32 minutes
AWS Connection: connected
Last Sync: 2024-01-15T10:30:45Z

System Information:
- CPU Usage: 12%
- Memory Usage: 45%
- Disk Usage: 67%
- Temperature: 42°C

Applications (2):
- MyApp v1.0.0: ok - Application running normally
- SensorApp v2.1.0: warning - High sensor readings detected
```

#### provision
Start or restart the device provisioning process.

```bash
sudo edgeberry provision [--force]
```

**Options**:
- `--force`: Force reprovisioning even if already provisioned

#### reconnect
Force reconnection to AWS IoT Core.

```bash
sudo edgeberry reconnect
```

#### reboot
Safely reboot the device with proper service shutdown.

```bash
sudo edgeberry reboot [--delay=seconds]
```

**Options**:
- `--delay`: Delay before reboot (default: 5 seconds)

#### logs
Display service logs with filtering options.

```bash
sudo edgeberry logs [--lines=N] [--follow] [--level=LEVEL]
```

**Options**:
- `--lines=N`: Show last N lines (default: 50)
- `--follow`: Follow log output in real-time
- `--level=LEVEL`: Filter by log level (debug, info, warn, error)

#### config
Manage device configuration settings.

```bash
sudo edgeberry config get [key]
sudo edgeberry config set <key> <value>
sudo edgeberry config list
```

**Configuration Keys**:
- `device.name`: Device display name
- `aws.endpoint`: AWS IoT endpoint URL
- `hardware.led.enabled`: Enable/disable status LED
- `hardware.buzzer.enabled`: Enable/disable buzzer
- `logging.level`: Log verbosity level

## Python SDK

The Edgeberry Python SDK provides a high-level interface for application development.

### Installation
```bash
pip install edgeberry
```

### Basic Usage

```python
from edgeberry import EdgeberrySDK
import time

# Initialize SDK
sdk = EdgeberrySDK()

# Register application
sdk.set_application_info(
    name="MyIoTApp",
    version="1.0.0", 
    description="My IoT sensor application"
)

# Update status
sdk.set_application_status("ok", "Starting up...")

# Get device information
device_info = sdk.get_device_info()
print(f"Device UUID: {device_info['uuid']}")
print(f"Device Status: {device_info['status']}")

# Listen for device state changes
def on_state_change(state):
    print(f"Device state changed: {state['device']['status']}")

sdk.on_device_state_changed(on_state_change)

# Main application loop
try:
    while True:
        # Your application logic here
        sdk.set_application_status("ok", "Running normally")
        time.sleep(60)
        
except KeyboardInterrupt:
    sdk.set_application_status("ok", "Shutting down")
    sdk.disconnect()
```

### Advanced SDK Features

#### State Management
```python
# Get current device state
state = sdk.get_device_state()

# Subscribe to specific state changes
sdk.on_connection_state_changed(lambda connected: 
    print(f"Connection: {'connected' if connected else 'disconnected'}")
)

# Get system metrics
metrics = sdk.get_system_metrics()
print(f"CPU: {metrics['cpu']}%, Memory: {metrics['memory']}%")
```

#### Hardware Control
```python
# Control status LED (if available)
sdk.set_led_pattern("blinking")  # "on", "off", "blinking", "fast-blink"

# Trigger buzzer (if available)
sdk.play_buzzer_pattern([200, 100, 200])  # Pattern in milliseconds

# Check hardware capabilities
caps = sdk.get_hardware_capabilities()
if caps['led_available']:
    sdk.set_led_pattern("on")
```

## Error Handling

### D-Bus Errors
- `org.freedesktop.DBus.Error.ServiceUnknown`: Edgeberry service not running
- `org.freedesktop.DBus.Error.InvalidArgs`: Invalid method arguments
- `org.freedesktop.DBus.Error.AccessDenied`: Insufficient permissions

### CLI Exit Codes
- `0`: Success
- `1`: General error
- `2`: Invalid arguments
- `3`: Service not running
- `4`: Permission denied
- `5`: Network/connection error

### Python SDK Exceptions
```python
from edgeberry.exceptions import (
    EdgeberryConnectionError,
    EdgeberryPermissionError,
    EdgeberryServiceError
)

try:
    sdk.set_application_status("ok", "Running")
except EdgeberryConnectionError:
    print("Cannot connect to Edgeberry service")
except EdgeberryPermissionError:
    print("Insufficient permissions")
except EdgeberryServiceError as e:
    print(f"Service error: {e}")
```

This API reference provides complete documentation for integrating with the Edgeberry Device Software from local applications.
