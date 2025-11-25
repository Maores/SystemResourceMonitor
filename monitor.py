import psutil
from rich.console import Console
from rich.panel import Panel
from time import sleep


def cpu_usage(interval):
    """
    Measures average CPU usage over a sampling window of `interval` seconds.
    This function blocks for the duration of `interval`

    Args:
    interval (float): A positive number representing the sampling window duration
        that the function will wait before returning

    Returns:
        float: CPU usage percentage
    """
    
    if not isinstance(interval, (int, float)):
        raise TypeError("interval must be a number")
        
    if interval <= 0:
        raise ValueError("interval must be positive")
    
    
    usage = psutil.cpu_percent(interval)
    
    return usage


def memory_usage():
    """
    Returns the current RAM usage
    
    Returns:
        float: RAM usage percentage
    """
    
    ram_usage = psutil.virtual_memory().percent
    
    return ram_usage


def disk_usage():
    """
    Measures the disk usage in the user's computer
    
    Returns:
        float: Disk Usage percentage
    """
    
    disk_info = psutil.disk_usage("C:\\").percent
    
    return disk_info


def main():
    console = Console()
    while True:
        cpu = cpu_usage(1)
        ram = memory_usage()
        disk = disk_usage()
        
        panel_text = (
            f"[bold yellow]CPU:[/bold yellow] {cpu:.1f}%\n"
            f"[bold cyan]RAM:[/bold cyan] {ram:.1f}%\n"
            f"[bold green]Disk:[/bold green] {disk:.1f}%\n"
        )
        
        console.clear()
        console.print(Panel(panel_text, title="System Resource Monitor"))
        


if __name__ == "__main__":
    main()