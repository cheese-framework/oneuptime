import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'mail';
const app = App(APP_NAME);

// API

import MailAPI from './API/Mail';

app.use([`/${APP_NAME}/email`, '/email'], MailAPI);

export default app;
