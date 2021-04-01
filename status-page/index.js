const express = require('express');
const path = require('path');
const app = express();

const https = require('https');
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const axios = require('axios');

const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /statuspage/.env
    require('dotenv').config();
}

app.get(['/env.js', '/status-page/env.js'], function(req, res) {
    let REACT_APP_FYIPE_HOST = null;
    let REACT_APP_BACKEND_PROTOCOL = null;
    if (!process.env.FYIPE_HOST) {
        if (req.host.includes('localhost')) {
            REACT_APP_FYIPE_HOST = 'http://' + req.host;
        } else {
            REACT_APP_FYIPE_HOST = 'https://' + req.host;
        }
    } else {
        REACT_APP_FYIPE_HOST = process.env.FYIPE_HOST;
        if (REACT_APP_FYIPE_HOST.includes('*.')) {
            REACT_APP_FYIPE_HOST = REACT_APP_FYIPE_HOST.replace('*.', ''); //remove wildcard from host.
        }
    }

    REACT_APP_BACKEND_PROTOCOL = process.env.BACKEND_PROTOCOL;

    const env = {
        REACT_APP_FYIPE_HOST,
        REACT_APP_BACKEND_PROTOCOL,
        REACT_APP_STATUSPAGE_CERT: process.env.STATUSPAGE_CERT,
        REACT_APP_STATUSPAGE_PRIVATEKEY: process.env.STATUSPAGE_PRIVATEKEY,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.use(express.static(path.join(__dirname, 'build')));
app.use('/status-page', express.static(path.join(__dirname, 'build')));
app.use(
    '/status-page/static/js',
    express.static(path.join(__dirname, 'build/static/js'))
);
app.use('/.well-known/acme-challenge/:token', async function(req, res) {
    // make api call to backend and fetch keyAuthorization
    const { token } = req.params;
    let apiHost;
    if (process.env.FYIPE_HOST) {
        apiHost = 'https://' + process.env.FYIPE_HOST + '/api';
    } else {
        apiHost = 'http://localhost:3002/api';
    }
    const url = `${apiHost}/ssl/challenge/authorization/${token}`;
    const response = await axios.get(url);
    console.log('****** KEYAUTHORIZATION RESPONSE ********', response.data);
    res.send(response.data);
});

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

async function fetchCredential(apiHost, credentialName, configPath) {
    return new Promise((resolve, reject) => {
        fetch(`${apiHost}/file/${credentialName}`).then(res => {
            const dest = fs.createWriteStream(configPath);
            res.body.pipe(dest);
            // at this point, writing to the specified file is complete
            dest.on('finish', async () => {
                resolve('done writing to file');
            });

            dest.on('error', async error => {
                reject(error);
            });
        });
    });
}

function decodeAndSave(content, filePath) {
    return new Promise(resolve => {
        const command = `echo ${content} | base64 -d`;
        let output = '';

        const commandOutput = spawn(command, {
            cwd: process.cwd(),
            shell: true,
        });
        commandOutput.stdout.on('data', data => {
            const strData = data.toString();
            output += strData;
        });
        commandOutput.on('close', () => {
            fs.writeFile(filePath, output, 'utf8', function() {
                resolve('Done writing to disc');
            });
        });
    });
}

function createDir(dirPath) {
    return new Promise((resolve, reject) => {
        const workPath = path.resolve(process.cwd(), 'src', dirPath);
        if (fs.existsSync(workPath)) {
            resolve(workPath);
        }

        fs.mkdir(workPath, error => {
            if (error) reject(error);
            resolve(workPath);
        });
    });
}

// using an IIFE here because we have an asynchronous code we want to run as we start the server
// and since we can't await outside an async function, we had to use an IIFE to handle that
(async function() {
    await createDir('credentials');
    // decode base64 of the cert and private key
    // store the value to disc
    const cert = process.env.STATUSPAGE_CERT;
    const certPath = path.resolve(
        process.cwd(),
        'src',
        'credentials',
        'certificate.crt'
    );
    const privateKey = process.env.STATUSPAGE_PRIVATEKEY;
    const privateKeyPath = path.resolve(
        process.cwd(),
        'src',
        'credentials',
        'private.key'
    );
    await Promise.all([
        decodeAndSave(cert, certPath),
        decodeAndSave(privateKey, privateKeyPath),
    ]);

    const options = {
        cert: fs.readFileSync(
            path.resolve(process.cwd(), 'src', 'credentials', 'certificate.crt')
        ),
        key: fs.readFileSync(
            path.resolve(process.cwd(), 'src', 'credentials', 'private.key')
        ),
        SNICallback: async function(domain, cb) {
            let apiHost;
            if (process.env.FYIPE_HOST) {
                apiHost = 'https://' + process.env.FYIPE_HOST + '/api';
            } else {
                apiHost = 'http://localhost:3002/api';
            }

            const res = await fetch(
                `${apiHost}/statusPage/tlsCredential?domain=${domain}`
            ).then(res => res.json());
            console.log('****** RESPONSE FROM BACKEND IS *********', res);

            let certPath, privateKeyPath;
            if (res) {
                const {
                    cert,
                    privateKey,
                    autoProvisioning,
                    enableHttps,
                    domain,
                } = res;
                // have a condition to check for autoProvisioning
                // if auto provisioning is set
                // fetch the stored cert/privateKey
                // cert and private key is a string
                // store it to a file on disk
                if (enableHttps && autoProvisioning) {
                    const url = `${apiHost}/certificate/store/cert/${domain}`;
                    const response = await axios.get(url);
                    const certificate = response.data;

                    certPath = path.resolve(
                        process.cwd(),
                        'src',
                        'credentials',
                        `${certificate.id}.crt`
                    );
                    privateKeyPath = path.resolve(
                        process.cwd(),
                        'src',
                        'credentials',
                        `${certificate.id}.key`
                    );

                    console.log(
                        '******** RESPONSE FOR CERTIFICATE/KEY ********',
                        certificate
                    );

                    fs.writeFileSync(certPath, certificate.cert);
                    fs.writeFileSync(privateKeyPath, certificate.privateKeyPem);

                    return cb(
                        null,
                        tls.createSecureContext({
                            key: fs.readFileSync(privateKeyPath),
                            cert: fs.readFileSync(certPath),
                        })
                    );
                }

                if (cert && privateKey) {
                    certPath = path.resolve(
                        process.cwd(),
                        'src',
                        'credentials',
                        `${cert}.crt`
                    );
                    privateKeyPath = path.resolve(
                        process.cwd(),
                        'src',
                        'credentials',
                        `${privateKey}.key`
                    );

                    await Promise.all([
                        fetchCredential(apiHost, cert, certPath),
                        fetchCredential(apiHost, privateKey, privateKeyPath),
                    ]);

                    return cb(
                        null,
                        tls.createSecureContext({
                            key: fs.readFileSync(privateKeyPath),
                            cert: fs.readFileSync(certPath),
                        })
                    );
                }
            }

            // default for custom domains without cert/key credentials
            return cb(
                null,
                tls.createSecureContext({
                    cert: fs.readFileSync(
                        path.resolve(
                            process.cwd(),
                            'src',
                            'credentials',
                            'certificate.crt'
                        )
                    ),
                    key: fs.readFileSync(
                        path.resolve(
                            process.cwd(),
                            'src',
                            'credentials',
                            'private.key'
                        )
                    ),
                })
            );
        },
    };
    http.createServer(app).listen(3006, () =>
        // eslint-disable-next-line no-console
        console.log('Server running on port 3006')
    );
    https
        .createServer(options, app)
        // eslint-disable-next-line no-console
        .listen(3007, () => console.log('Server running on port 3007'));
})();
