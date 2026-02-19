# Edgeberry Device Software - Project Regeneration Prompt

## Project Overview

The **Edgeberry Device Software** is a TypeScript-based IoT device management system that transforms Linux devices (primarily Raspberry Pi) into managed IoT devices connected to the Edgeberry cloud platform via AWS IoT Core.

## Core Purpose & Value Proposition

Create a robust, production-ready device software that:
- Provisions Linux devices to AWS IoT Core with secure X.509 certificate-based authentication
- Maintains persistent, secure MQTT connections for bidirectional communication
- Provides device state management and shadow synchronization
- Integrates with Edgeberry-specific hardware (HAT EEPROM, status LED, buzzer, user button)
- Offers both CLI and D-Bus API interfaces for local applications
- Supports remote device management operations (reboot, update, reconnect)
- Enables fleet provisioning and user device linking

## Technical Architecture

### Core Technologies
- **Runtime**: Node.js with TypeScript
- **IoT Protocol**: MQTT via AWS IoT Device SDK v2
- **IPC**: D-Bus for inter-process communication
- **System Integration**: systemd service
- **Hardware Interface**: GPIO, I2C, EEPROM reading
- **Security**: X.509 certificates, fleet provisioning

### Project Structure
```
Edgeberry-device-software/
├── src/                    # TypeScript source code
│   ├── main.ts            # Application entry point
│   ├── aws.client.ts      # AWS IoT Core client implementation
│   ├── dbus.interface.ts  # D-Bus API implementation
│   ├── state.manager.ts   # Device state management
│   ├── system.service.ts  # System operations (LED, buzzer, button)
│   ├── settings.store.ts  # Configuration management
│   ├── application.service.ts # Application lifecycle management
│   └── direct.methods.ts  # Remote method handlers
├── scripts/               # Shell scripts for deployment and management
│   ├── install.sh        # Device installation script
│   ├── deploy.sh         # Development deployment script
│   ├── setup.sh          # Device setup and provisioning
│   ├── edgeberry_cli.sh  # Command-line interface
│   └── uninstall.sh      # Removal script
├── config/               # Configuration files
│   ├── edgeberry-core.conf # Application configuration
│   └── io.edgeberry.core.service # systemd service definition
├── build/                # Compiled JavaScript output
├── certificates/         # Device certificates (runtime)
└── docs/                 # Project documentation
```

## Key Components & Responsibilities

### 1. AWS Client (`aws.client.ts`)
- Manages AWS IoT Core connection lifecycle
- Handles MQTT pub/sub operations
- Implements certificate-based authentication
- Manages device shadow synchronization
- Handles fleet provisioning workflows

### 2. D-Bus Interface (`dbus.interface.ts`)
- Exposes `io.edgeberry.Core` D-Bus service
- Provides API for local applications
- Methods: SetApplicationInfo, SetApplicationStatus
- Enables inter-process communication

### 3. State Manager (`state.manager.ts`)
- Centralizes device state management
- Synchronizes local state with AWS device shadow
- Handles state persistence
- Manages application status aggregation

### 4. System Service (`system.service.ts`)
- Hardware abstraction layer
- Controls status LED patterns
- Manages buzzer operations
- Handles user button interactions
- Reads HAT EEPROM for device identification

### 5. Direct Methods (`direct.methods.ts`)
- Implements remote device operations
- Handles cloud-initiated commands
- Operations: reboot, update, reconnect, link-to-user

## Installation & Deployment Flow

### End-User Installation
1. Download `install.sh` from GitHub releases
2. Script downloads latest release package
3. Installs systemd service and configuration
4. Sets up CLI command (`edgeberry`)
5. Starts device provisioning process

### Development Deployment
1. Build TypeScript to JavaScript (`npm run build`)
2. Deploy to target device (`npm run deploy`)
3. Copy files to appropriate system locations
4. Restart systemd service

## Configuration Requirements

### Environment Variables
- Device-specific certificates path
- AWS IoT endpoint configuration
- Hardware GPIO pin mappings
- Network interface preferences

### Hardware Dependencies
- Raspberry Pi or compatible Linux device
- Edgeberry HAT with EEPROM (optional but recommended)
- GPIO access for LED/buzzer control
- Network connectivity (WiFi/Ethernet)

## Security Model

### Certificate Management
- X.509 certificate-based device authentication
- Fleet provisioning for automated certificate generation
- Secure certificate storage in `/etc/edgeberry/certificates/`
- Certificate rotation support

### Communication Security
- TLS 1.2+ for all MQTT communications
- AWS IoT Core policy-based access control
- Device shadow access restrictions
- Secure D-Bus interface with appropriate permissions

## API Interfaces

### CLI Interface (`edgeberry` command)
```bash
sudo edgeberry --help           # Show help
sudo edgeberry status           # Show device status
sudo edgeberry provision        # Start provisioning
sudo edgeberry reconnect        # Reconnect to cloud
sudo edgeberry reboot           # Reboot device
```

### D-Bus API (`io.edgeberry.Core`)
```
SetApplicationInfo({"name": string, "version": string, "description": string})
SetApplicationStatus({"status": "ok|warning|error|critical", "message": string})
```

### Python SDK Integration
- Provides high-level Python API
- Abstracts D-Bus communication
- Simplifies application development

## Hardware Integration

### Edgeberry HAT Features
- **EEPROM**: Device UUID and board identification
- **Status LED**: Visual device state indication
- **Buzzer**: Audio feedback for user interactions
- **User Button**: Physical interaction for pairing/identification

### LED Patterns
- Solid: Normal operation
- Blinking: Connecting/provisioning
- Fast blink: Error state
- Off: Service stopped

## Remote Operations

### Cloud-Initiated Commands
- **Reboot**: Safe device restart
- **Update**: Software update trigger
- **Reconnect**: Force MQTT reconnection
- **Link-to-User**: Associate device with user account
- **Identify**: Trigger LED/buzzer for physical identification

## Development Requirements

### Dependencies
```json
{
  "dependencies": {
    "aws-iot-device-sdk-v2": "^1.19.1",
    "dbus-native": "^0.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.30",
    "nodemon": "^3.1.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.3"
  }
}
```

### Build Process
1. TypeScript compilation (`tsc`)
2. Asset copying (scripts, configs)
3. Package creation for distribution
4. GitHub Actions for automated releases

## Quality Requirements

### Reliability
- Automatic reconnection on network failures
- Graceful handling of AWS service interruptions
- State persistence across reboots
- Error recovery mechanisms

### Performance
- Minimal resource usage (suitable for Raspberry Pi Zero)
- Efficient MQTT message handling
- Low-latency local API responses
- Optimized startup time

### Maintainability
- Clear separation of concerns
- Comprehensive error logging
- Configuration-driven behavior
- Modular architecture

## Regeneration Instructions

To recreate this project from scratch:

1. **Initialize Node.js/TypeScript project**
   - Set up package.json with specified dependencies
   - Configure TypeScript with appropriate target settings
   - Set up build scripts and development workflow

2. **Implement core services**
   - Start with basic AWS IoT connection
   - Add D-Bus interface for local communication
   - Implement state management layer
   - Add hardware abstraction for GPIO/I2C

3. **Create deployment infrastructure**
   - Build installation scripts for end-user deployment
   - Create systemd service configuration
   - Implement CLI interface wrapper
   - Set up development deployment automation

4. **Add security and provisioning**
   - Implement certificate management
   - Add fleet provisioning workflow
   - Secure D-Bus interface appropriately
   - Add proper error handling and logging

5. **Integrate hardware features**
   - Implement LED control patterns
   - Add buzzer functionality
   - Handle user button interactions
   - Read HAT EEPROM for device identification

6. **Testing and validation**
   - Test on target hardware (Raspberry Pi)
   - Validate AWS IoT Core integration
   - Verify D-Bus API functionality
   - Test installation and deployment scripts

This prompt provides the complete specification needed to regenerate the Edgeberry Device Software project with all its core functionality and architectural decisions.
