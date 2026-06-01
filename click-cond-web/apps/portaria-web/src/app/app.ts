import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ConfirmHostComponent } from './shared/confirm-host.component';
import { ToastHostComponent } from './shared/toast-host.component';

@Component({
  imports: [RouterModule, ConfirmHostComponent, ToastHostComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected title = 'portaria-web';
}
