const axios = require('axios');
const cheerio = require('cheerio');

// Vercel serverless function
module.exports = async (req, res) => {
    // 允許跨來源請求，方便本地測試
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter "q"' });
    }

    const isUBN = /^\d{8}$/.test(query);
    const TARGET_URL = 'https://serv.gcis.nat.gov.tw/caseSearch/list/QueryCsmmCaseList/queryCsmmCaseList.do?caseType=C';

    try {
        // --- Step 1: GET a token from the page ---
        const firstResponse = await axios.get(TARGET_URL);
        const $ = cheerio.load(firstResponse.data);
        const ownerToken = $('input[name="__owner"]').val();
        const keyToken = $('input[name="__key"]').val();

        if (!ownerToken) {
            throw new Error('Could not retrieve security tokens.');
        }

        // --- Step 2: POST with the query and the token ---
        const formData = new URLSearchParams();
        formData.append('caseType', 'C');
        formData.append('ctName', 'C');
        formData.append('qryCond', isUBN ? '2' : '1');
        formData.append('brName', isUBN ? '' : query);
        formData.append('brBanNo', isUBN ? query : '');
        formData.append('__owner', ownerToken);
        formData.append('__key', keyToken);

        const secondResponse = await axios.post(TARGET_URL, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // --- Step 3: Parse the results ---
        const $$ = cheerio.load(secondResponse.data);
        
        // 檢查是否有查無資料的訊息
        const noDataMessage = $$('td.p_center.p_fb').text().trim();
        if (noDataMessage.includes('查無相關案件資料')) {
            return res.status(200).json({ error: '查無相關案件資料', cases: [] });
        }

        const companyInfo = $$('td.p_lt.p_td_h.p_fb').text().trim().match(/(.+)\((\d{8})\)/);

        const cases = [];
        $$('tr.odd, tr.even').each((i, elem) => {
            const columns = $$(elem).find('td');
            if (columns.length === 5) {
                cases.push({
                    date: $$(columns[0]).text().trim(),
                    caseNumber: $$(columns[1]).text().trim(),
                    caseName: $$(columns[2]).text().trim(),
                    agency: $$(columns[3]).text().trim(),
                    status: $$(columns[4]).text().trim(),
                });
            }
        });
        
        res.status(200).json({
            companyName: companyInfo ? companyInfo[1] : null,
            companyUBN: companyInfo ? companyInfo[2] : null,
            cases: cases,
        });

    } catch (error) {
        res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
};