from edgeberry.edgeberry import Edgeberry
from edgeberry.edgeberry_cloudconnect import EdgeberryCloudConnect

def main():
    edgeberry = Edgeberry()
    edgeberry.set_application_info("example", "v3.2.1", "Edgeberry application example")
    edgeberry.set_status("ok", "blub")

    cloudConnect = EdgeberryCloudConnect()
    cloudConnect.send_message("test message")


if __name__ == "__main__":
    main()