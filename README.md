# Edge Gateway
Whether you are a weathered engineer making a quick proof-of-concept for an IoT solution, or a student of the information technology arts dipping your toes in the shallow part of the connected devices pool. With this Edge Gateway project you turn your favorite single-board computer platform into an IoT Edge device in the blink of a cursor!

The Edge Gateway is a stand-alone software packet that allows you to connect your device to the cloud without having to dive into the details, so you can put all your focus on your application. The Edge Gateway comes with an intuitive user interface for configuration and monitoring the cloud connection, available on your local network.

##### Supported IoT platforms:
- Microsoft Azure IoT Hub

## Installation
Install the Edge Gateway application by downloading and executing the installation script.
```
wget -O install.sh https://github.com/SpuQ/Edge_Gateway/releases/download/v2.2.0/install.sh
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

Note that these pins are controlled by the Edge Gateway application, and should not be used for your application to avoid unexpected behavior.

## Using the SDK
When creating your application for the Edge Gateway, use the [Edge Gateway SDK](https://github.com/SpuQ/Edge_Gateway_SDK) for interacting with the Edge Gateway.

```
npm install --save @spuq/edge_gateway_sdk
```
For information on using the SDK, check out the [SDK documentation](https://github.com/SpuQ/Edge_Gateway_SDK?tab=readme-ov-file#readme).

## License & Collaboration
Copyright 2024 Sanne 'SpuQ' Santens. This project is licensed under the [MIT License](LICENSE.txt).

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.