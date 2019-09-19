process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
var moment = require('moment');

const request = chai.request.agent(app);

var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var IncidentService = require('../backend/services/incidentService');
var MonitorService = require('../backend/services/monitorService');
var NotificationService = require('../backend/services/notificationService');
var VerificationTokenModel = require('../backend/models/verificationToken');

let token, userId, projectId, monitorId, monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' }
};
let endDate = moment().format('YYYY-MM-DD');
let startDate = moment().subtract(7, 'd').format('YYYY-MM-DD');

describe('Reports API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            let project = res.body.project;
            projectId = project._id;
            userId = res.body.id;
            VerificationTokenModel.findOne({ userId }, function (err, verificationToken) {
                request.get(`/user/confirmation/${verificationToken.token}`).redirects(0).end(function () {
                    request.post('/user/login').send({
                        email: userData.user.email,
                        password: userData.user.password
                    }).end(function (err, res) {
                        token = res.body.tokens.jwtAccessToken;
                        var authorization = `Basic ${token}`;
                        request.post(`/monitor/${projectId}`).set('Authorization', authorization).send(monitor).end(function (err, res) {
                            monitorId = res.body[0]._id;
                            done();
                        });
                    });
                });
            });
        });
    });

    after(async function () {
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await IncidentService.hardDeleteBy({ monitorId: monitorId });
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await NotificationService.hardDeleteBy({ projectId: projectId });
    });


    it('should return list of most active members', (done) => {
        const authorization = `Basic ${token}`;

        request.get(`/reports/${projectId}/active-members?startDate=${startDate}&&endDate=${endDate}&&skip=0&&limit=10`)
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should return list of most active monitors', (done) => {
        const authorization = `Basic ${token}`;
        request.get(`/reports/${projectId}/active-monitors?startDate=${startDate}&&endDate=${endDate}&&skip=0&&limit=10`)
            .set('Authorization', authorization)
            .end((err, res) => {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                done();
            });
    });

    it('should return average resolved incident in a month', (done) => {
        const authorization = `Basic ${token}`;
        request.get(`/reports/${projectId}/average-resolved`).set('Authorization', authorization).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });

    it('should return monthly average time to resolve incidents', (done) => {
        const authorization = `Basic ${token}`;
        request.get(`/reports/${projectId}/monthly-incidents`).set('Authorization', authorization).end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body).to.be.an('object');
            done();
        });
    });
});
