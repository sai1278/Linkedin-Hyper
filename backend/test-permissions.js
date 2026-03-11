const http = require('http');

async function testAdminAPI() {
    console.log("Starting test...");

    // 1. Login
    const loginData = JSON.stringify({ email: 'glynacadmin@glynac.ai', password: 'GlynacAdmin123' });

    const loginReq = http.request({
        hostname: '127.0.0.1',
        port: 4002,
        path: '/admin/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': loginData.length
        }
    }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
            const token = JSON.parse(body).data.token;
            console.log("Got token:", token ? "YES" : "NO");

            if (!token) {
                console.log(body);
                return;
            }

            // 2. Fetch Permissions
            const permReq = http.request({
                hostname: '127.0.0.1',
                port: 4002,
                path: '/admin/users/me/permissions',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }, res2 => {
                let body2 = '';
                res2.on('data', d => body2 += d);
                res2.on('end', () => {
                    console.log("Permissions status:", res2.statusCode);
                });
            });
            permReq.end();
        });
    });

    loginReq.write(loginData);
    loginReq.end();
}

testAdminAPI();
