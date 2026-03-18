module.exports = {

  config: {

    name: "lq",

    aliases: [],

    version: "1.0.0",

    hasPermssion: 0,

    credits: "Lịnh",

    description: "Lấy 10 tài khoản Liên Quân",

    commandCategory: "Utility",

    usages: ".lq",

    cooldowns: 5

  },

  run: async ({ send }) => {

    try {

      const url = "https://tangacclienquan.shop"

      const response = await global.axios.get(url,{

        headers:{ "User-Agent":"Mozilla/5.0" },

        timeout: 15000

      })

      const text = response.data

      const regex = /([a-zA-Z0-9._-]{4,})\|([a-zA-Z0-9._@#-]{4,})/g

      let match

      let accounts = []

      let seen = new Set()

      while((match = regex.exec(text)) !== null){

        let user = match[1]

        let pass = match[2]

        // lọc dữ liệu rác

        if(

          user.includes("taikhoan") ||

          pass.includes("matkhau") ||

          user.includes("jpg") ||

          user.includes("gif") ||

          user.includes("pdf") ||

          user.includes("doc") ||

          user.includes("html")

        ){

          continue

        }

        // loại trùng

        let key = user + "|" + pass

        if(seen.has(key)) continue

        seen.add(key)

        accounts.push({user,pass})

      }

      if(accounts.length === 0){

        return send("❌ Không tìm thấy tài khoản.")

      }

      const list = accounts.slice(0,10)

      let msg = "🎮 10 TÀI KHOẢN LIÊN QUÂN\n\n"

      list.forEach((acc,i)=>{

        msg += `${i+1}. ${acc.user} | ${acc.pass}\n`

      })

      msg += `\n📦 Tổng tìm được: ${accounts.length}`

      await send(msg)

    } catch(err){

      await send("❌ Lỗi: " + err.message)

    }

  }

}