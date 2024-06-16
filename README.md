![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/EdgeBerry_banner_device_software.png)

The **Edgeberry Device Software** connects your device to the Edgeberry Dashboard, enabeling remote device management. It manages the on-board status indicators for providing useful feedback and assigns essential functions, like device reset, to the physical button. The Edgeberry Device Software offers a commandline interface for interacting with the software.

## Installation
On your device, install the Edgeberry Device Software by downloading and executing the installation script
```
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh;
chmod +x ./install.sh;
sudo ./install.sh;
```
If the installation was successful, you can now access your Edgeberry's web interface from your local network
```
http://<device_ip_address>:3000
```
or you can access the Edgeberry Commandline Interface (CLI):
```
$ sudo edgeberry --help
```

## Application development
In your own application, you can send commands to the **Edgeberry CLI**.

> [!WARNING]
> The **Edgeberry CLI** is under active development. Run the 'help' command to get an overview of its current possibilities.
```
sudo edgeberry --help
```

> [!IMPORTANT]  
> Following IO pins are controlled by the Edgeberry application to use with the [Edgeberry Hardware](https://github.com/SpuQ/EdgeBerry?tab=readme-ov-file#edgeberry-hardware), and should not be used in your application to avoid unpredictable behavior: **GPIO5** (buzzer), **GPIO6** (button), **GPIO19** (status LED, red), **GPIO26** (status LED, green).

## License & Collaboration
**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry device software is licensed under the **[GNU GPLv3](LICENSE.txt)**.

>[!IMPORTANT]
>When your own application uses the Edgeberry API to interact with the Edgeberry software, **the GNU GPLv3 does <ins>not</ins> affect your project**, and you are free to publish (or not publish) your project however you like. I know reading "GNU GPL" in a repository can be intimidating, but no worries there!

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.