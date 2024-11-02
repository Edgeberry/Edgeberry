![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/EdgeBerry_banner_device_software.png)

The **Edgeberry Device Software** connects your device to the Edgeberry Dashboard, enabeling remote device management. It manages the on-board status indicators for providing useful feedback and assigns essential functions, like device reset, to the physical button. The Edgeberry Device Software offers a commandline interface for interacting with the software.

## Installation
On your device, install the Edgeberry Device Software by downloading and executing the installation script
```
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh;
chmod +x ./install.sh;
sudo ./install.sh;
```
If the installation was successful, you can access the Edgeberry Commandline Interface (CLI):
```
$ sudo edgeberry --help
```

## Application development
### CLI
In your own application, you can interact with the Edgeberry Device Software using the **Edgeberry CLI**.
```
sudo edgeberry --help
```
### D-BUS API
Edgeberry uses inter-process communication through D-Bus to interact with other applications.

| Object           | Method              | Argument                                                    | 
|------------------|---------------------|-------------------------------------------------------------|
|io.edgeberry.Core |SetApplicationInfo   | {"name":[string],"version":[string],"description":[string]} |
|                  |SetApplicationStatus | {"status":[ok/warning/error/critical],"message":[string]}   |


## License & Collaboration
**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry Device Software is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.