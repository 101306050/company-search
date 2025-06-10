const axios = require('axios');
const cheerio = require('cheerio');

// 所有機關的代碼和名稱
const agencies = {
    "00": "經濟部商業發展署", "62": "臺北市政府", "64": "高雄市政府", "65": "新北市政府",
    "66": "臺中市政府", "67": "臺南市政府", "68": "桃園市政府", "01": "基隆市政府",
    "02": "新竹市政府", "04": "嘉義市政府", "14": "宜蘭縣政府", "03": "新竹縣政府",
    "15": "桃園縣政府", "05": "苗栗縣政府", "17": "彰化縣政府", "06": "南投縣政府",
    "07": "雲林縣政府", "18": "嘉義縣政府", "10": "屏東縣政府", "08": "花蓮縣政府",
    "11": "臺東縣政府", "12": "澎湖縣政府", "20": "金門縣政府", "21": "連江縣政府",
    "09": "經濟部產業園區管理局", "A1": "國家科學及技術委員會新竹科學園區管理局", "B1": "國家科學及技術委員會中部科學園區管理局",
    "C1": "國家科學及技術委員會南部科學園區管理局", "E1": "屏東農業生物技術園區"
};

// 封裝單次查詢的邏輯，方便重複呼叫
async function fetchSingleAgency(query, agencyCode) {
    const isUBN = /^\d{8}$/.test(query);
    const TARGET_URL = 'https://serv.gcis.nat.gov.tw/caseSearch/list/QueryCsmmCaseList/queryCsmmCaseList.do?caseType=C';

    try {
        // Step 1: GET a token
        const firstResponse = await axios.get(TARGET_URL, { timeout: 10000 });
        const $ = cheerio.load(firstResponse.data);
        const ownerToken = $('input[name="__owner"]').val();
        const keyToken = $('input[name="__key"]').val();

        if (!ownerToken || !keyToken) {
             throw new Error(`無法從 ${agencies[agencyCode] || agencyCode} 獲取安全權杖。`);
        }

        // Step 2: POST with the query and the token
        const formData = new URLSearchParams();
        formData.append('caseType', 'C');
        formData.append('ctName', 'C');
        formData.append('qryCond', isUBN ? '2' : '1');
        formData.append('brName', isUBN ? '' : query);
        formData.append('brBanNo', isUBN ? query : '');
        formData.append('agency', agencyCode);
        formData.append('__owner', ownerToken);
        formData.append('__key', keyToken);

        const secondResponse = await axios.post(TARGET_URL, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
        });

        // Step 3: Parse the results
        const $$ = cheerio.load(secondResponse.data);
        
        if ($$('td.p_center.p_fb').text().trim().includes('查無相關案件資料')) {
            return { agency: agencyCode, cases: [] };
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

        return {
            agency: agencyCode,
            companyName: companyInfo ? companyInfo[1] : null,
            companyUBN: companyInfo ? companyInfo[2] : null,
            cases: cases,
        };
    } catch (error) {
        // 在單次查詢中捕獲錯誤，並將其作為結果的一部分返回
        // 這樣即使某個機關查詢失敗，也不會中斷整個掃描流程
        console.error(`Error fetching for agency ${agencyCode}:`, error.message);
        return { agency: agencyCode, error: error.message, cases: [] };
    }
}


// Vercel serverless function 主入口
module.exports = async (req, res) => {
    // 增加 Vercel Serverless Function 的最大執行時間
    // Vercel Hobby plan is 10s by default. Pro can extend.
    // This is more of a placeholder for awareness.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    const query = req.query.q;
    const agencyCode = req.query.agency;

    if (!query) return res.status(400).json({ error: '請提供查詢關鍵字' });
    if (!agencyCode) return res.status(400).json({ error: '請選擇申登機關' });

    // --- 模式一：序列化掃描全部機關 ---
    if (agencyCode === 'all') {
        const finalResults = {};
        const agencyCodes = Object.keys(agencies).filter(code => code !== 'all');

        // 使用 for...of 迴圈來確保請求是一個接一個地發送
        for (const code of agencyCodes) {
            try {
                // 等待上一個查詢完成後，再開始下一個
                const result = await fetchSingleAgency(query, code);
                finalResults[code] = result;
            } catch (error) {
                // 即使發生意外錯誤，也記錄下來，然後繼續下一個
                finalResults[code] = { agency: code, error: error.message, cases: [] };
            }
        }
        return res.status(200).json({ isScan: true, results: finalResults });
    } 
    // --- 模式二：查詢指定機關 ---
    else {
        try {
            const result = await fetchSingleAgency(query, agencyCode);
            if (result.error) {
                return res.status(500).json({ error: result.error });
            }
            return res.status(200).json(result);
        } catch (error) {
            return res.status(500).json({ error: `查詢過程中發生錯誤: ${error.message}` });
        }
    }
};
