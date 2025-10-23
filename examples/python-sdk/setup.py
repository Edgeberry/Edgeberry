from setuptools import setup, find_packages

setup(
    name="edgeberry",
    version="3.1.0",
    author="Sanne 'SpuQ' Santens",
    author_email="sanne.santens@gmail.com",
    description="Python SDK for interfacing applications with Edgeberry Device Software",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/Edgeberry/Edgeberry-device-software/tree/main/examples/python-sdk",
    packages=find_packages(),
    install_requires=[
        "pydbus",   # List dependencies here
        "PyGObject"
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires='>=3.6',
)