import { Component } from '@angular/core';
import Config from "../config.json";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html'
})
export class AppComponent {
  environment = Config.ENV;
  baseUrl = Config.BASE_URL;
}
