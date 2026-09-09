import { Controller, Get, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { extractClientIp } from './common/context/request-context';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @Get('debug-ip')
  getDebugIp(@Req() req: any) {
    return {
      resolvedIp: extractClientIp(req),
      reqIp: req.ip,
      headers: {
        'x-vercel-forwarded-for': req.headers['x-vercel-forwarded-for'],
        'cf-connecting-ip': req.headers['cf-connecting-ip'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
        'true-client-ip': req.headers['true-client-ip'],
      },
    };
  }

  @Get('api/debug-ip')
  getDebugIpApi(@Req() req: any) {
    return this.getDebugIp(req);
  }
}
