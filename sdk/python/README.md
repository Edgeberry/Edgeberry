![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_SDK.png)

<img src="https://s3.dualstack.us-east-2.amazonaws.com/pythondotorg-assets/media/community/logos/python-logo-only.png" align="right" width="10%"/>

The **Edgeberry Python SDK** is a software library to facilitate communication between Python application and the **Edgeberry Device Software**. The Edgeberry Python SDK interacts with the Edgeberry Device Software throught the D-Bus API.

<br clear="right"/>

## Usage
Install the package using `pip`
```shell
pip install edgeberry
```
After installation, the `edgeberry` library can be used as follows
```python
# Import the library in your application
from edgeberry import Edgeberry

# Create the Edgeberry object
edgeberry = Edgeberry()

# Available methods
edgeberry.set_application_info("name", "version", "description")    # Called when the program (re)starts
edgeberry.set_status("level", "message")                            # Level can be ok|warning|error|critical
```

## License & Collaboration
**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry Python SDK is licensed under the **[MIT License](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.