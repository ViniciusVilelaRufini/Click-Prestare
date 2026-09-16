import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ConfirmHostComponent } from './shared/confirm-host.component';
import { ToastHostComponent } from './shared/toast-host.component';
import { NetworkBannerComponent } from './shared/network-banner.component';

@Component({
  imports: [RouterModule, ConfirmHostComponent, ToastHostComponent, NetworkBannerComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected title = 'portaria-web';
}

