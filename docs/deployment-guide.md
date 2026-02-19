# Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the Edgeberry Device Software in various environments, from development to production.

## Development Environment Setup

### Prerequisites
- Node.js 18+ with npm
- TypeScript compiler
- Linux development environment (Ubuntu/Debian recommended)
- SSH access to target Raspberry Pi devices

### Local Development Setup

1. **Clone and Install Dependencies**
```bash
git clone https://github.com/Edgeberry/Edgeberry-device-software.git
cd Edgeberry-device-software
npm install
```

2. **Development Build and Test**
```bash
# Build TypeScript
npm run build

# Run in development mode with auto-reload
npm run dev

# Test build output
npm start
```

3. **Configure Target Device**
```bash
# Edit deployment configuration
nano scripts/deploy.sh

# Set target device IP and credentials
export DEVICE_IP="192.168.1.100"
export DEVICE_USER="pi"
```

### Development Deployment

Deploy to a development Raspberry Pi for testing:

```bash
# Deploy to target device
npm run deploy
```

This script:
- Builds the TypeScript project
- Copies files to the target device
- Installs/updates the systemd service
- Restarts the Edgeberry service

## Production Deployment

### End-User Installation

For end users installing on their devices:

```bash
# Download and run installation script
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh
chmod +x ./install.sh
sudo ./install.sh
```

### Development Pre-release Installation

For testing pre-release versions:

```bash
# Install development build with --dev flag
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh
chmod +x ./install.sh
sudo ./install.sh --dev
```

## Release Process

### Creating a Release

1. **Prepare Release**
```bash
# Update version in package.json
npm version patch|minor|major

# Build and test
npm run build
npm test  # when tests are available

# Commit version bump
git add package.json
git commit -m "Bump version to $(node -p "require('./package.json').version")"
```

2. **Create GitHub Release**
```bash
# Tag the release
git tag v$(node -p "require('./package.json').version")
git push origin main --tags
```

3. **GitHub Actions Workflow**
The `.github/workflows/release.yml` automatically:
- Builds the project
- Creates release packages
- Uploads installation scripts
- Publishes release assets

### Release Package Structure
```
edgeberry-device-software-v2.8.2.tar.gz
├── build/                 # Compiled JavaScript
├── scripts/              # Installation and management scripts
├── config/               # Configuration files
├── package.json          # Package metadata
└── README.md            # Installation instructions
```

## System Integration

### systemd Service Configuration

The service is installed as `/etc/systemd/system/io.edgeberry.core.service`:

```ini
[Unit]
Description=Edgeberry Core Service
After=network.target
Wants=network.target

[Service]
Type=simple
User=edgeberry
Group=edgeberry
ExecStart=/usr/bin/node /opt/edgeberry/build/main.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
WorkingDirectory=/opt/edgeberry

[Install]
WantedBy=multi-user.target
```

### File System Layout

Production installation creates:

```
/opt/edgeberry/                    # Application directory
├── build/                         # Compiled application
├── package.json                   # Package metadata
└── node_modules/                  # Dependencies (if needed)

/etc/edgeberry/                    # Configuration directory
├── edgeberry-core.conf           # Main configuration
└── certificates/                  # Device certificates
    ├── device.pem.crt            # Device certificate
    ├── private.pem.key           # Private key
    └── root-CA.crt               # Root CA certificate

/usr/local/bin/                    # CLI tools
└── edgeberry                      # CLI wrapper script

/var/log/edgeberry/               # Log directory
└── edgeberry-core.log            # Service logs
```

### User and Permissions

The installation creates:
- System user: `edgeberry`
- System group: `edgeberry`
- D-Bus policy for `io.edgeberry.Core`
- GPIO/I2C access permissions

## Configuration Management

### Environment-Specific Configuration

#### Development Configuration
```json
{
  "environment": "development",
  "logging": {
    "level": "debug",
    "console": true
  },
  "aws": {
    "endpoint": "your-dev-endpoint.iot.region.amazonaws.com"
  },
  "hardware": {
    "mockMode": true
  }
}
```

#### Production Configuration
```json
{
  "environment": "production", 
  "logging": {
    "level": "info",
    "console": false,
    "file": "/var/log/edgeberry/edgeberry-core.log"
  },
  "aws": {
    "endpoint": "your-prod-endpoint.iot.region.amazonaws.com"
  },
  "hardware": {
    "mockMode": false
  }
}
```

### Configuration Override

Configuration can be overridden via:
1. Environment variables (highest priority)
2. Configuration file (`/etc/edgeberry/edgeberry-core.conf`)
3. Default values (lowest priority)

Environment variable mapping:
- `EDGEBERRY_AWS_ENDPOINT` → `aws.endpoint`
- `EDGEBERRY_LOG_LEVEL` → `logging.level`
- `EDGEBERRY_DEVICE_NAME` → `device.name`

## Monitoring and Maintenance

### Health Checks

```bash
# Check service status
sudo systemctl status io.edgeberry.core

# View recent logs
sudo journalctl -u io.edgeberry.core -n 50

# Check device status via CLI
sudo edgeberry status
```

### Log Management

```bash
# View live logs
sudo journalctl -u io.edgeberry.core -f

# View logs with specific time range
sudo journalctl -u io.edgeberry.core --since "2024-01-01" --until "2024-01-02"

# Export logs for analysis
sudo journalctl -u io.edgeberry.core --output=json > edgeberry-logs.json
```

### Performance Monitoring

```bash
# Monitor resource usage
top -p $(pgrep -f "edgeberry")

# Check memory usage
sudo systemctl show io.edgeberry.core --property=MemoryCurrent

# Monitor network connections
sudo netstat -tulpn | grep node
```

## Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check service logs
sudo journalctl -u io.edgeberry.core -n 20

# Verify file permissions
ls -la /opt/edgeberry/
ls -la /etc/edgeberry/

# Check configuration syntax
node -c /opt/edgeberry/build/main.js
```

#### AWS Connection Issues
```bash
# Verify certificates
sudo edgeberry config get aws.endpoint
ls -la /etc/edgeberry/certificates/

# Test network connectivity
ping your-endpoint.iot.region.amazonaws.com
openssl s_client -connect your-endpoint.iot.region.amazonaws.com:8883
```

#### Hardware Issues
```bash
# Check GPIO permissions
groups edgeberry
ls -la /dev/gpiomem

# Test I2C access
sudo i2cdetect -y 1

# Verify EEPROM
sudo hexdump -C /sys/class/i2c-adapter/i2c-1/1-0050/eeprom | head
```

### Recovery Procedures

#### Complete Reinstallation
```bash
# Remove existing installation
sudo /opt/edgeberry/scripts/uninstall.sh

# Clean reinstall
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh
chmod +x ./install.sh
sudo ./install.sh
```

#### Certificate Reset
```bash
# Backup existing certificates
sudo cp -r /etc/edgeberry/certificates /etc/edgeberry/certificates.backup

# Remove certificates to force reprovisioning
sudo rm -rf /etc/edgeberry/certificates/*

# Restart service to trigger reprovisioning
sudo systemctl restart io.edgeberry.core
```

## Security Considerations

### Certificate Management
- Certificates stored with restricted permissions (600)
- Private keys never transmitted over network
- Automatic certificate rotation support
- Secure certificate backup procedures

### Network Security
- TLS 1.2+ enforced for all communications
- Certificate pinning for AWS IoT endpoints
- Local D-Bus interface restricted to authorized users
- Firewall configuration for minimal attack surface

### Update Security
- Signed release packages
- Checksum verification during installation
- Rollback capability for failed updates
- Secure update channel via GitHub releases

This deployment guide ensures reliable, secure, and maintainable installations across all environments.
