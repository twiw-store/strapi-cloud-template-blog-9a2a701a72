import routes from './routes/custom-auth';
import customAuth from './controllers/custom-auth';

export default {
  routes,
  controllers: {
    'custom-auth': customAuth,
  },
};
