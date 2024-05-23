![Edgeberry logo](assets/Edgeberry_banner.png)

The Edgeberry Device Software is lorem ipsum dolores si amet ...

# Installation
On your device, install the Edgeberry application by downloading and executing the installation script
```
wget -O install.sh https://github.com/SpuQ/Edgeberry/releases/download/v2.4.0/install.sh
chmod +x ./install.sh
sudo ./install.sh
```
If everything was successful, you can now access your Edgeberry's web interface in your local network
```
http://<device_ip_address>:3000
```

# Application development
In your own application, you can send commands to the **Edgeberry CLI**.

> [!WARNING]
> The SDK is currently undergoing substantial changes in architecture. Because of this, no information is currently available or published. But we'll get to it as soon as possible!

> [!IMPORTANT]  
> Following IO pins are controlled by the Edgeberry application to use with the [Edgeberry Hardware](https://github.com/SpuQ/EdgeBerry?tab=readme-ov-file#edgeberry-hardware), and should not be used in your application to avoid unpredictable behavior: **GPIO5** (buzzer), **GPIO6** (button), **GPIO19** (status LED, red), **GPIO26** (status LED, green).

# License & Collaboration
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