![Edgeberry logo](assets/EdgeBerry_banner.png)


The IoT Edge is one of the most compelling frontiers in information technology; the domain where the digital realm converges with the physical world through interconnected devices equipped with sensors and actuators. This technology empowers data-driven decision making, streamlining of processes, enhance monitoring capabilities, ... So, for example, you can unload the laundry just-in-time (_smart washing machine_) before your partner noticeably gets upset (_wearable heart rate monitor_), significantly improving your quality of life.


Whether you are a weathered engineer making a quick proof-of-concept for an IoT solution, or a student of the information technology arts dipping your toes in the shallow part of the connected devices pool. With the Edgeberry project you turn your favorite single-board computer into an IoT Edge device in the blink of a cursor! Leveraging the robust foundation of this trusted, open-source, and widely supported computing system, EdgeBerry seamlessly integrates essential IoT functionalities allowing you to fully focus on bringing your IoT idea to life.

##### Edgeberry's device software provides:
- An intuitive web interface for configuring the cloud connection and managing your application, available on your local network
- Reliable integration of device provisioning and connection processes for several popular IoT platforms
- A comprihensive SDK to interface your edge device application to the cloud

##### Integrated IoT platforms:
- AWS IoT Core _(currently recommended)_
- Microsoft Azure IoT Hub

# Installation
Install the Edgeberry application by downloading and executing the installation script on your device.
```
wget -O install.sh https://github.com/SpuQ/EdgeBerry/releases/download/v2.3.1/install.sh
sudo ./install.sh
```
If everything was successful, you can now access your Edgeberry's web interface on port 3000
```
http://<device_ip_address>:3000
```

## Raspberry Pi I/O setup
When using Raspberry Pi as your edge device using EdgeBerry, you can add following features for a better user experience:

| GPIO Pin | Feature          |
|----------|------------------|
| 5        | Buzzer           |
| 6        | Button           |
| 19       | Red status LED   |
| 26       | Green status LED |

These IO pins are controlled by the Edgeberry application, and should not be used in your application to avoid unexpected behavior.

# Application development
When creating your IoT Edge application with Edgeberry, use the [Edgeberry SDK](https://github.com/SpuQ/EdgeBerry-SDK) for interacting with the cloud through the Edgeberry platform.

```
NodeJS:
npm install --save @spuq/edgeberry-sdk
```
For information on using the SDK, check out the [SDK documentation](https://github.com/SpuQ/EdgeBerry-SDK?tab=readme-ov-file#readme).

# Edgeberry Project

The Edgeberry project aims to provide the essentials for using your Raspberry Pi or compatible platform in a wide range of IoT applications, increasing the accessability of the IoT Edge and enabling rapid development of IoT applications.

### Edgeberry Hardware
EdgeBerry features a [Raspberry Pi-compatible hat](https://edgeberry.io), enhancing its capabilities with a built-in 3A step-down power supply enabling you to power your device reliably using a 12V adaptor. Additionally, it includes indicators for providing status feedback, and an expansion slot for integrating custom hardware. To improve reliability of your EdgeBerry setup in real-world environment deployments, use the [EdgeBerry enclosure](https://thingiverse.com/SpuQ) for enhanced protection.

### Edgeberry Dashboard
For managing your fleet of Edgeberry devices, create an account on [Edgeberry.io](https://edgeberry.io/dashboard) and connect your IoT platform.

# License & Collaboration
Copyright 2024 Sanne 'SpuQ' Santens. The Edgeberry device software is licensed under the [MIT License](LICENSE.txt).

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.