# Edge Gateway

A device managing local sensor/actuator connections, performing basic data processing, and facilitating cloud communication.
TODO: short sales pitch

##### Supported IoT platforms:
- Microsoft Azure IoT Hub

## Installation
Install the Edge Gateway application by downloading and running the installation script.
```
wget -O install.sh https://github.com/SpuQ/Edge_Gateway/releases/download/v2.0.2/install.sh
sudo ./install.sh
```
Follow the instructions in the installation process.

### Raspberry Pi: I/O setup
When using Raspberry Pi as your Edge Gateway device, you can add following IO features for a better user experience:

| GPIO Pin | Feature          |
|----------|------------------|
| 5        | Buzzer           |
| 6        | Button           |
| 19       | Red status LED   |
| 26       | Green status LED |

Note that these pins are controlled by the Edge Gateway application, and should not be used for your application to avoid conflict.


## License & Copyright
Copyright Sanne 'SpuQ' Santens, all rights reserved.
