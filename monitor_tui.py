from textual.app import App, ComposeResult
from textual.widgets import Static
from monitor import cpu_usage, memory_usage, disk_usage
from rich.panel import Panel
from rich.align import Align



class MonitorApp(App):
    """Minimal Textual App for the System Resource Monitor project"""
    
    def compose(self) -> ComposeResult:
        self.monitor = Static("System Resource Monitor - TUI version")
        yield self.monitor
    
    def on_mount(self) -> None:
        self.set_interval(1, self.update_metrics)
        
    def update_metrics(self) -> None:
        cpu = cpu_usage(0.5)   # faster sampling for smoother updates
        ram = memory_usage()
        disk = disk_usage()
        
        def bar(percent):
            filled = int(percent // 10)
            empty = 10 - filled
            return "█" * filled + "░" * empty
        
        panel_text = (
        f"[bold yellow]CPU:[/bold yellow]  {bar(cpu)}  [yellow]{cpu:.1f}%[/yellow]\n"
        f"[bold cyan]RAM:[/bold cyan] {bar(ram)}  [cyan]{ram:.1f}%[/cyan]\n"
        f"[bold green]Disk:[/bold green] {bar(disk)}  [green]{disk:.1f}%[/green]"
         )
        
        self.monitor.update(
            Align.center(
                Panel(
                    panel_text,
                    title="System Resource Monitor",
                    border_style="white",
                    padding=(1, 2),
                    expand=False,  # let the panel fit its content
                )
            )
        )



    
if __name__ == "__main__" :
    app = MonitorApp()
    app.run()